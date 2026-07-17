"use client";

import { useState, useTransition, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Copy, PlusCircle, MoreHorizontal, Trash2, Crown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { getUserByCreatorId } from '@/lib/data.client';
import { createNotification } from '@/actions/notifications-client';
import { CubeSpinner } from '../ui/CubeSpinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { usePlatformInfo, useRefreshAfterTx } from '@/context/BlockchainContext';
import { useStellarContract } from '@/hooks/use-stellar-contract';
import { ThresholdCard } from './ThresholdCard';

interface AdminManagementProps {
  isMainAdmin: boolean;
}

const addAdminFormSchema = z.object({
  address: z.string().refine(val => val.startsWith('G') && val.length === 56, {
    message: 'Please enter a valid Stellar public key address.',
  }),
});
type AddAdminFormSchema = z.infer<typeof addAdminFormSchema>;

type AdminInfo = {
  address: string;
  name?: string;
  avatarUrl?: string;
  role: 'multi-sig' | 'fee-wallet';
};

async function getUserByAddress(address: string) {
  return getUserByCreatorId(address, 'stellarPublicKey');
}

export function AdminManagement({ isMainAdmin }: AdminManagementProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { platformInfo } = usePlatformInfo();
  const refreshAfterTx = useRefreshAfterTx();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [admins, setAdmins] = useState<AdminInfo[]>([]);
  const [adminToRemove, setAdminToRemove] = useState<AdminInfo | null>(null);
  const [isRemoveAlertOpen, setIsRemoveAlertOpen] = useState(false);

  const { addMultisigAdmin, removeMultisigAdmin } = useStellarContract();

  const form = useForm<AddAdminFormSchema>({
    resolver: zodResolver(addAdminFormSchema),
    defaultValues: { address: '' },
  });

  useEffect(() => {
    const fetchAdminDetails = async () => {
      if (!platformInfo) return;

      const adminAddresses = platformInfo.multiSigAdmins || [];
      const feeWalletAddress = platformInfo.feeWalletAddress;

      const allAdmins: AdminInfo[] = [];

      if (feeWalletAddress) {
        const feeAdminInfo = await getUserByAddress(feeWalletAddress);
        allAdmins.push({
          address: feeWalletAddress,
          name: feeAdminInfo?.name || 'Fee Wallet Admin',
          avatarUrl: feeAdminInfo?.creatorAvatar,
          role: 'fee-wallet',
        });
      }

      const multiSigAdminDetails = await Promise.all(
        adminAddresses.map(async (address: string) => {
          if (address === feeWalletAddress) return null;
          const userInfo = await getUserByAddress(address);
          return {
            address,
            name: userInfo?.name || 'Unknown User',
            avatarUrl: userInfo?.creatorAvatar,
            role: 'multi-sig' as const,
          };
        })
      );

      const multiSigAdmins = multiSigAdminDetails.flatMap((admin) => (admin ? [admin] : []));
      allAdmins.push(...multiSigAdmins);
      setAdmins(allAdmins);
    };

    fetchAdminDetails();
  }, [platformInfo]);

  const handleCopy = (address: string) => {
    navigator.clipboard.writeText(address);
    toast({
      title: 'Address Copied',
      description: 'The wallet address has been copied to your clipboard.',
    });
  };

  const handleRemoveAdmin = async () => {
    if (!adminToRemove || !user) return;

    startTransition(async () => {
      try {
        const result = await removeMultisigAdmin({ target: adminToRemove.address });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Remove admin transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        createNotification(user.uid, "Admin Removed", `Multi-sig admin ${adminToRemove.name} has been removed.`, txUrl);
        await refreshAfterTx();
        toast({
          title: 'Admin Removed Successfully',
          description: 'The administrator has been successfully removed.',
        });
        setIsRemoveAlertOpen(false);
        setAdminToRemove(null);
      } catch (error: any) {
        toast({ title: 'Transaction Failed', description: error.message || String(error), variant: 'destructive' });
      }
    });
  };

  const onSubmit = (values: AddAdminFormSchema) => {
    if (!user) return;

    startTransition(async () => {
      try {
        const result = await addMultisigAdmin({ newAdmin: values.address });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Add admin transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash ? `https://stellar.expert/explorer/testnet/tx/${txHash}` : null;

        createNotification(user.uid, "Admin Added", `A new multi-sig admin has been added.`, txUrl);

        const newUserInfo = await getUserByAddress(values.address);
        if (newUserInfo) {
          createNotification(newUserInfo.uid, "You are now an Admin", `You have been added as a multi-sig admin.`, txUrl);
        }

        await refreshAfterTx();
        toast({
          title: "New Admin Added Successfully",
          description: "A new administrator was added to the multi-sig group.",
        });
        setIsDialogOpen(false);
        form.reset();
      } catch (error: any) {
        toast({ title: 'Transaction Failed', description: error.message || String(error), variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6">
      <ThresholdCard
        currentThreshold={platformInfo?.multisigThreshold ?? 2}
        totalAdmins={platformInfo?.multiSigAdmins?.length ?? 0}
        isMainAdmin={isMainAdmin}
      />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Manage Admins</CardTitle>
            <CardDescription>
              Add, view, or remove administrators with multi-sig capabilities.
            </CardDescription>
          </div>
          {isMainAdmin && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add New Admin
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Multi-Sig Admin</DialogTitle>
                  <DialogDescription>
                    Enter the Stellar public key address of the user you want to grant multi-sig admin privileges to.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Admin Wallet Address</FormLabel>
                          <FormControl>
                            <Input placeholder="G..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                      </DialogClose>
                      <Button type="submit" disabled={isPending}>
                        {isPending ? <CubeSpinner /> : 'Add Admin'}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Wallet Address</TableHead>
                {isMainAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => (
                <TableRow key={admin.address}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={admin.avatarUrl} alt={admin.name} />
                        <AvatarFallback>{admin.name ? admin.name.charAt(0) : '?'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{admin.name}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {admin.role === 'fee-wallet' ? (
                      <Badge variant="destructive" className="flex items-center gap-1.5 w-fit">
                        <Crown className="h-3 w-3" />
                        Fee Wallet
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Multi-sig</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm truncate max-w-xs">{admin.address}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCopy(admin.address)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  {isMainAdmin && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0" disabled={admin.role === 'fee-wallet'}>
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setAdminToRemove(admin);
                              setIsRemoveAlertOpen(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove Admin
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {admins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isMainAdmin ? 4 : 3} className="h-24 text-center">
                    No administrators found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={isRemoveAlertOpen} onOpenChange={setIsRemoveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <span className="font-bold">{adminToRemove?.name}</span>'s admin privileges on-chain. This action can be reversed by adding them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAdminToRemove(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveAdmin} disabled={isPending} className="bg-destructive hover:bg-destructive/90">
              {isPending ? <CubeSpinner /> : "Yes, Remove Admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}