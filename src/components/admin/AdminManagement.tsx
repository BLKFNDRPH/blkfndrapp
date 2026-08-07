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
import {
  getAdminsAction,
  grantAdminAction,
  revokeAdminAction,
} from '@/actions/admins';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';
import { getUserByCreatorId } from '@/lib/data.client';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { usePlatformInfo, useRefreshAfterTx } from '@/context/BlockchainContext';
import { useStellarContract } from '@/hooks/use-stellar-contract';

interface AdminManagementProps {
  isMainAdmin: boolean;
}

const addAdminFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for this administrator.').max(120),
  // The email is what decides whether someone is an admin when they sign in;
  // the wallet is what the ledger will accept a signature from. Both are taken
  // here so an administrator exists once, rather than half-existing in two
  // places and needing a second visit to a different card to finish.
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(320),
  address: z.string().trim().regex(/^G[A-Z2-7]{55}$/, {
    message: 'Enter a valid Stellar address — 56 characters beginning with G.',
  }),
});
type AddAdminFormSchema = z.infer<typeof addAdminFormSchema>;

type AdminInfo = {
  address: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  role: 'multi-sig' | 'fee-wallet' | 'unlinked';
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

  const { addAdmin, removeAdmin, transferAdminOwnership } = useStellarContract();

  const form = useForm<AddAdminFormSchema>({
    resolver: zodResolver(addAdminFormSchema),
    defaultValues: { name: '', email: '', address: '' },
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

      // Names come from the admin roster, not from a profile lookup keyed on
      // wallet address. That lookup returned 'Unknown User' for every row,
      // because an admin who has never signed in has no profile to find — and
      // right after granting someone access is exactly when the roster most
      // needs to be able to say who they are.
      const rosterRes = await getAdminsAction();
      const roster = rosterRes.success ? rosterRes.admins : [];
      const byWallet = new Map(
        roster
          .filter((a) => a.walletAddress)
          .map((a) => [a.walletAddress as string, a] as const),
      );

      const multiSigAdminDetails: (AdminInfo | null)[] = adminAddresses.map(
        (address: string) => {
          if (address === feeWalletAddress) return null;
          const known = byWallet.get(address);
          if (known) {
            return {
              address,
              name: known.name,
              email: known.email,
              role: 'multi-sig' as const,
            };
          }
          // On the ledger but not in the roster. Shown as exactly that rather
          // than as a nameless admin, because it means a wallet can sign while
          // nobody knows whose it is — which is the thing to go and fix.
          return {
            address,
            name: 'Not in the console roster',
            role: 'unlinked' as const,
          };
        },
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

  /**
   * Hand the roster to another admin.
   *
   * Has to happen here rather than from the CLI: once ownership moves off the
   * deployer, the owner's key lives in a wallet extension and `stellar contract
   * invoke` has nothing to sign with. The alternative would be exporting a
   * secret key, which is worse than any convenience it buys.
   */
  const handleTransferOwnership = (admin: AdminInfo) => {
    startTransition(async () => {
      try {
        const result = await transferAdminOwnership(admin.address);
        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Transfer ownership transaction failed on-chain.");
        }
        await refreshAfterTx();
        toast({
          title: "Ownership transferred",
          description: `${admin.name ?? admin.address.slice(0, 8)} can now add and remove administrators. You no longer can.`,
        });
      } catch (error: any) {
        toast({
          title: "Transfer failed",
          description: error.message || String(error),
          variant: "destructive",
        });
      }
    });
  };

  const handleRemoveAdmin = async () => {
    if (!adminToRemove || !user) return;

    startTransition(async () => {
      try {
        const result = await removeAdmin(adminToRemove.address);

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Remove admin transaction failed on-chain.");
        }

        // Revoking the wallet is only half of it. Leaving the console row
        // behind would let them keep signing in and reading identity documents
        // long after the ledger stopped accepting their signature — the
        // dangerous direction for stale access to fail in.
        const revoked = adminToRemove.email
          ? await revokeAdminAction(adminToRemove.email)
          : { success: true as const, error: undefined };

        await refreshAfterTx();

        if (!revoked.success) {
          toast({
            title: 'Wallet revoked, console access remains',
            description: `${adminToRemove.email} can no longer sign, but can still sign in. ${revoked.error ?? ''}`,
            variant: 'destructive',
          });
          setIsRemoveAlertOpen(false);
          setAdminToRemove(null);
          return;
        }

        toast({
          title: 'Administrator removed',
          description: adminToRemove.email
            ? `${adminToRemove.email} can no longer sign in or sign transactions.`
            : 'The wallet was removed from the on-chain roster.',
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
        const result = await addAdmin(values.address);

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Add admin transaction failed on-chain.");
        }

        // The ledger accepted the wallet; now record who it belongs to. This
        // order matters: only the chain half needs a signature, and a console
        // row written for a transaction that never landed would grant sign-in
        // access to someone the ledger does not recognise.
        const recorded = await grantAdminAction(
          values.email,
          values.address,
          values.name,
        );

        await refreshAfterTx();

        if (!recorded.success) {
          // Half-applied, and saying so plainly is the only honest option: the
          // wallet can sign but the person cannot sign in. Left for the operator
          // to retry rather than silently rolled back, because undoing the chain
          // half needs another signature they may not want to give right now.
          toast({
            title: "Added on-chain, but not to the console",
            description: `This wallet can sign, but ${values.email} cannot sign in yet. ${recorded.error ?? ""} Add them again to finish.`,
            variant: "destructive",
          });
          setIsDialogOpen(false);
          form.reset();
          return;
        }

        toast({
          title: "Administrator added",
          description: `${values.name} can sign in with ${values.email}, and sign transactions with this wallet.`,
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
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Manage Admins</CardTitle>
            <CardDescription>
              Administrators can reach the admin console. No address here can release a milestone, block a refund, or move a vault balance.
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
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Jane Dela Cruz" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="name@example.com" {...field} />
                          </FormControl>
                          <FormDescription>
                            How they sign in, and what identifies them as an
                            administrator.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Wallet Address</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="G..."
                              className="font-mono text-xs"
                              spellCheck={false}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Added to the on-chain roster in the same step, which
                            needs your signature.
                          </FormDescription>
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
                          {platformInfo?.owner &&
                            admin.address !== platformInfo.owner && (
                              <DropdownMenuItem
                                onClick={() => handleTransferOwnership(admin)}
                              >
                                <Crown className="mr-2 h-4 w-4" />
                                Make roster owner
                              </DropdownMenuItem>
                            )}
                          {/* The owner cannot be removed: only the owner may
                              edit the roster, so removing them would leave a
                              list nobody can ever change again. The contract
                              refuses with WouldOrphanRoster — offering it here
                              just produced a failed signature and an error
                              nobody could act on. Transfer ownership first. */}
                          <DropdownMenuItem
                            disabled={admin.address === platformInfo?.owner}
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setAdminToRemove(admin);
                              setIsRemoveAlertOpen(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {admin.address === platformInfo?.owner
                              ? "Owner — transfer ownership first"
                              : "Remove Admin"}
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