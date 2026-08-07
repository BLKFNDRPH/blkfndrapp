"use client";

import { useTransition, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { useToast } from '@/hooks/use-toast';
import { Slider } from '../ui/slider';
import { Input } from '../ui/input';
import { CubeSpinner } from '../ui/CubeSpinner';
import { useAuth } from '@/context/AuthContext';
import { createNotification } from '@/actions/notifications-client';
import { usePlatformInfo, useRefreshAfterTx } from '@/context/BlockchainContext';
import { useStellarContract } from '@/hooks/use-stellar-contract';

const formSchema = z.object({
  feePercentage: z.coerce.number().min(0, "Fee cannot be negative.").max(100, "Maximum fee is 100%."),
});

type FormSchema = z.infer<typeof formSchema>;

export function PlatformFeeForm() {
  const { user } = useAuth();
  const { platformInfo } = usePlatformInfo();
  const refreshAfterTx = useRefreshAfterTx();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const { updatePlatformFee } = useStellarContract();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      feePercentage: 0,
    },
  });

  useEffect(() => {
    if (platformInfo?.feePercentage !== undefined) {
      form.reset({
        feePercentage: platformInfo.feePercentage / 100,
      });
    }
  }, [platformInfo, form]);

  const onSubmit = (values: FormSchema) => {
    startTransition(async () => {
      try {
        const feeBps = Math.round(values.feePercentage * 100);

        const result = await updatePlatformFee(BigInt(feeBps));

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        if (user) {
          createNotification(
            user.uid,
            "Platform Fee Updated",
            "Platform fee percentage has been changed successfully.",
            txUrl
          );
        }

        await refreshAfterTx();

        toast({
          title: 'Platform Fee Updated Successfully',
          description: 'The platform fee has been successfully updated on-chain.',
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

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsEditing(false);
    const value = parseFloat(e.target.value);

    if (!isNaN(value)) {
      form.setValue('feePercentage', Math.max(0, Math.min(100, value)), { shouldValidate: true });
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputBlur(e as any);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Fee</CardTitle>
        <CardDescription>
          Define the platform fee percentage applied to generated funds. Values are in percentage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="feePercentage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Fee Percentage:
                    {isEditing ? (
                      <Input
                        type="number"
                        defaultValue={field.value.toFixed(2)}
                        onBlur={handleInputBlur}
                        onKeyDown={handleInputKeyDown}
                        autoFocus
                        className="w-20 h-8"
                        step="0.01"
                      />
                    ) : (
                      <span
                        onClick={() => setIsEditing(true)}
                        className="font-bold cursor-pointer rounded-md px-2 py-1 hover:bg-muted"
                      >
                        {field.value.toFixed(2)}%
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                     <Slider
                        min={0}
                        max={100}
                        step={0.01}
                        value={[field.value]}
                        onValueChange={(value) => field.onChange(value[0])}
                      />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending}>
              {isPending && <CubeSpinner />}
              Save Platform Fee
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}