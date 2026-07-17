"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Pencil, Minus, Plus, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useRefreshAfterTx } from "@/context/BlockchainContext";
import { useStellarContract } from "@/hooks/use-stellar-contract";
import { createNotification } from "@/actions/notifications-client";
import { CubeSpinner } from "../ui/CubeSpinner";
import { motion, AnimatePresence } from "framer-motion";

interface ThresholdCardProps {
  currentThreshold: number;
  totalAdmins: number;
  isMainAdmin: boolean;
}

export function ThresholdCard({
  currentThreshold,
  totalAdmins,
  isMainAdmin,
}: ThresholdCardProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const refreshAfterTx = useRefreshAfterTx();
  const { updateMultisigThreshold } = useStellarContract();

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentThreshold);
  const [isPending, startTransition] = useTransition();

  const validationError =
    editValue < 1
      ? "Threshold must be at least 1."
      : editValue > totalAdmins
        ? "Threshold cannot exceed total number of admins."
        : null;

  const isSaveDisabled =
    isPending || editValue === currentThreshold || validationError !== null;

  const handleEdit = () => {
    setEditValue(currentThreshold);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(currentThreshold);
  };

  const handleDecrement = () => {
    setEditValue((prev) => Math.max(1, prev - 1));
  };

  const handleIncrement = () => {
    setEditValue((prev) => Math.min(totalAdmins, prev + 1));
  };

  const handleSave = () => {
    if (isSaveDisabled || !user) return;

    startTransition(async () => {
      try {
        const result = await updateMultisigThreshold({
          newThreshold: editValue,
        });

        const txStatus = (result as any)?.getTransactionResponse?.status;
        if (txStatus !== "SUCCESS") {
          throw new Error("Threshold update transaction failed on-chain.");
        }

        const txHash = (result as any)?.sendTransactionResponse?.hash;
        const txUrl = txHash
          ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
          : null;

        createNotification(
          user.uid,
          "Threshold Updated",
          `Multisig threshold changed from ${currentThreshold} to ${editValue}.`,
          txUrl,
        );

        await refreshAfterTx();

        toast({
          title: "Threshold Updated",
          description: `Multisig threshold has been changed to ${editValue} of ${totalAdmins}.`,
        });

        setIsEditing(false);
      } catch (error: any) {
        toast({
          title: "Transaction Failed",
          description: error.message || String(error),
          variant: "destructive",
        });
      }
    });
  };

  return (
    <Card
      id="threshold-config-card"
      className="border-slate-800 bg-card/80 backdrop-blur-sm overflow-hidden"
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          {/* Left: Icon + Display */}
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#003049]/10 flex items-center justify-center shrink-0">
              <Shield className="h-6 w-6 text-[#003049] dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                Signature Threshold
              </p>

              <AnimatePresence mode="wait">
                {!isEditing ? (
                  <motion.div
                    key="display"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="flex items-baseline gap-2 mt-1"
                  >
                    <span className="text-2xl font-bold text-foreground tabular-nums">
                      {currentThreshold}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      of{" "}
                      <span className="font-semibold text-foreground">
                        {totalAdmins}
                      </span>{" "}
                      Required
                    </span>
                    <Badge
                      variant="secondary"
                      className="ml-2 text-[10px] font-semibold"
                    >
                      Multi-sig
                    </Badge>
                  </motion.div>
                ) : (
                  <motion.div
                    key="editor"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.15 }}
                    className="mt-1 space-y-2"
                  >
                    {/* Stepper */}
                    <div className="flex items-center gap-2">
                      <Button
                        id="threshold-decrement"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleDecrement}
                        disabled={isPending || editValue <= 1}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-2xl font-bold text-foreground tabular-nums w-10 text-center select-none">
                        {editValue}
                      </span>
                      <Button
                        id="threshold-increment"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleIncrement}
                        disabled={isPending || editValue >= totalAdmins}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-sm text-muted-foreground ml-1">
                        of{" "}
                        <span className="font-semibold text-foreground">
                          {totalAdmins}
                        </span>
                      </span>
                    </div>

                    {/* Validation error */}
                    {validationError && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="text-xs text-red-500 font-medium"
                      >
                        {validationError}
                      </motion.p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right: Action buttons */}
          {isMainAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              {!isEditing ? (
                <Button
                  id="threshold-edit-btn"
                  variant="outline"
                  size="sm"
                  onClick={handleEdit}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Threshold
                </Button>
              ) : (
                <>
                  <Button
                    id="threshold-cancel-btn"
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                    disabled={isPending}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    id="threshold-save-btn"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaveDisabled}
                    className="gap-1.5 bg-[#003049] hover:bg-[#003049]/90 text-white"
                  >
                    {isPending ? (
                      <CubeSpinner />
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        Save
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
