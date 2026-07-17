"use client";

import { useTransition, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { useToast } from '@/hooks/use-toast';
import { useStellarContract } from '@/hooks/use-stellar-contract';
import { useFreighterWallet } from '@/context/FreighterWalletContext';
import { isStellarPublicKey } from '@/lib/freighter-connect';
import Link from 'next/link';
import { CubeSpinner } from '../ui/CubeSpinner';
import { createNotification } from '@/actions/notifications-client';
import { useAuth } from '@/context/AuthContext';
import { usePlatformInfo, useRefreshAfterTx } from '@/context/BlockchainContext';

const formSchema = z.object({
  feeWalletAddress: z.string().refine(val => isStellarPublicKey(val), {
    message: 'Please enter a valid Stellar public key.',
  }),
  feeWalletEmail: z.string().email('Please enter a valid email address.'),
});

type FormSchema = z.infer<typeof formSchema>;

export function InternalDetails() {
  const { user } = useAuth();
  const { platformInfo } = usePlatformInfo();
  const refreshAfterTx = useRefreshAfterTx();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const { setFeeWallet } = useStellarContract();
  const { freighterWalletAddress } = useFreighterWallet();

  const form = useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      feeWalletAddress: '',
      feeWalletEmail: '',
    },
  });

  useEffect(() => {
    if (platformInfo) {
      form.reset({
        feeWalletAddress: platformInfo.feeWalletAddress || '',
        feeWalletEmail: platformInfo.feeWalletEmail || '',
      });
    }
  }, [platformInfo, form]);

  const onSubmit = (values: FormSchema) => {
    startTransition(async () => {
      try {
        if (!freighterWalletAddress) {
          toast({
            title: "Wallet Not Connected",
            description: "Please connect your Freighter wallet to perform this action.",
            variant: "destructive",
          });
          return;
        }

        const result = await setFeeWallet({
          feeWalletAddress: values.feeWalletAddress,
          feeWalletEmail: values.feeWalletEmail,
          admin: freighterWalletAddress,
        });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Transaction failed on-chain.");
        }

        // Persist the email in MongoDB and wait for confirmation
        const emailRes = await fetch("/api/admin/platform-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feeWalletEmail: values.feeWalletEmail }),
        });

        if (!emailRes.ok) {
          const errData = await emailRes.json().catch(() => ({}));
          console.error("Failed to save fee wallet email:", errData);
          toast({
            title: "Email Save Failed",
            description: "The on-chain wallet was updated, but the email could not be saved to the database.",
            variant: "destructive",
          });
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        if (user) {
          createNotification(
            user.uid,
            "Fee Wallet Updated",
            `The platform's fee wallet has been changed to ${values.feeWalletAddress}.`,
            txUrl
          );
        }

        // Wait for MongoDB write to propagate before refreshing the context
        await refreshAfterTx();
        toast({
          title: 'Fee Wallet Updated!',
          description: txUrl ? (
             <Link href={txUrl} target="_blank" rel="noopener noreferrer" className="underline">
                View transaction on Stellar.Expert
             </Link>
          ) : 'Successfully updated fee wallet.',
        });
      } catch (error: any) {
        toast({
          title: 'On-Chain Update Failed',
          description: error.message || String(error),
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Official Internal Details</CardTitle>
        <CardDescription>
          Set the wallet address and email used to collect platform fees.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="feeWalletAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fee Wallet Address</FormLabel>
                  <FormControl>
                    <Input placeholder="G..." {...field} />
                  </FormControl>
                  <FormDescription>The Stellar wallet address that will receive platform fees.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="feeWalletEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fee Wallet Email</FormLabel>
                  <FormControl>
                    <Input placeholder="admin@blkfndr.com" {...field} />
                  </FormControl>
                  <FormDescription>The contact email associated with the fee wallet.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending}>
              {isPending && <CubeSpinner />}
              Save Internal Details
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}