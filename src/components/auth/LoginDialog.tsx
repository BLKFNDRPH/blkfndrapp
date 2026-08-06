"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Loader2, AlertCircle } from "lucide-react";
import StaticBLKFNDR from "../layout/StaticBLKFNDR";
import { useState } from "react";

interface LoginDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void | Promise<void>;
}

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      fill="#EA4335"
    />
  </svg>
);

export function LoginDialog({
  isOpen,
  onClose,
}: LoginDialogProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = () => {
    setIsConnecting(true);
    setError(null);
    try {
      // The OAuth nonce and state are minted server-side by this endpoint and
      // stored in an httpOnly cookie, so the callback can actually verify them.
      // Building the Google URL here meant nothing ever checked either value.
      const returnTo = typeof window !== "undefined" ? window.location.pathname : "/profile";
      window.location.href = `/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;
    } catch (err: any) {
      console.error("[LoginDialog] Google login redirect error:", err);
      setError("Failed to redirect to Google Login.");
      setIsConnecting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-md border border-neutral-800/80 bg-neutral-950/90 backdrop-blur-xl p-6 rounded-2xl shadow-2xl shadow-purple-500/5"
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
            Sign in with your Google account to access your profile, browse projects, and manage your account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col space-y-4 pt-6">
          <Button
            onClick={handleGoogleLogin}
            variant="outline"
            disabled={isConnecting}
            className="relative h-12 w-full border border-neutral-800 hover:border-neutral-700 bg-neutral-900/40 hover:bg-neutral-800/40 text-neutral-200 hover:text-white transition-all duration-300 rounded-xl flex items-center justify-center font-medium shadow-sm hover:shadow-purple-500/5 overflow-hidden group"
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-purple-400" />
                Redirecting to Google...
              </>
            ) : (
              <>
                <GoogleIcon className="mr-2.5 h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                Sign in with Google
              </>
            )}
          </Button>

          {error && (
            <div className="flex items-start space-x-2 text-xs bg-red-950/20 border border-red-900/30 p-3 rounded-lg animate-in fade-in slide-in-from-top-1 duration-200">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
              <span className="text-red-400">{error}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
