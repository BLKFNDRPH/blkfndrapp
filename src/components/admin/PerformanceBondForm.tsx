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
import { usePlatformInfo, useRefreshAfterTx } from '@/context/BlockchainContext';
import { useStellarContract } from '@/hooks/use-stellar-contract';

const formSchema = z.object({
  bondPercentage: z.coerce.number().min(0, "Performance bond cannot be negative.").max(100, "Maximum performance bond is 100%."),
});

type FormSchema = z.infer<typeof formSchema>;

export function PerformanceBondForm() {
  const { user } = useAuth();
  const { platformInfo } = usePlatformInfo();
  const refreshAfterTx = useRefreshAfterTx();
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();
  const { updateBondPercentage } = useStellarContract();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<FormSchema>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      bondPercentage: 5,
    },
  });

  useEffect(() => {
    if (platformInfo?.bondPercentage !== undefined) {
      form.reset({
        bondPercentage: platformInfo.bondPercentage / 100,
      });
    }
  }, [platformInfo, form]);

  const onSubmit = (values: FormSchema) => {
    startTransition(async () => {
      try {
        const bondBps = Math.round(values.bondPercentage * 100);

        const result = await updateBondPercentage(BigInt(bondBps));

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        if (user) {        }

        await refreshAfterTx();

        toast({
          title: 'Minimum Performance Bond Updated Successfully',
          description: 'The minimum performance bond percentage has been successfully updated on-chain.',
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
      form.setValue('bondPercentage', Math.max(0, Math.min(100, value)), { shouldValidate: true });
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
        <CardTitle>Platform Minimum Performance Bond</CardTitle>
        <CardDescription>
          Define the minimum performance bond percentage required from campaign creators relative to their project goal. Values are in percentage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="bondPercentage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    Bond Percentage:
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
              Save Platform Bond
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
