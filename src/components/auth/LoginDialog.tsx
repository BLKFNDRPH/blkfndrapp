"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import StaticBLKFNDR from "../layout/StaticBLKFNDR";
import { AuthForm } from "./AuthForm";

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void | Promise<void>;
}

export function LoginDialog({ isOpen, onClose }: LoginDialogProps) {
  const pathname = usePathname();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-md border border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xl p-6 rounded-2xl shadow-2xl shadow-black/40"
        hideCloseButton
      >
        <DialogClose className="absolute right-4 top-4 rounded-full p-1.5 bg-neutral-900/60 hover:bg-neutral-800/80 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-all focus:outline-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogClose>

        <DialogHeader className="text-center space-y-2">
          <DialogTitle className="text-2xl font-bold tracking-tight text-white">
            Log Into{" "}
            <span className="inline-block align-middle ml-1">
              <StaticBLKFNDR />
            </span>
          </DialogTitle>
          <DialogDescription className="text-neutral-400 text-sm">
            Sign in to back projects, track your contributions, and manage your account.
          </DialogDescription>
        </DialogHeader>

        <div className="pt-6">
          <AuthForm next={pathname || "/profile"} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
