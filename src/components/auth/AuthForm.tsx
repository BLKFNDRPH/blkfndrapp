"use client";

import { useState, useTransition } from "react";
import { Loader2, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  type AuthActionResult,
} from "@/app/auth/actions";

const GoogleIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
  </svg>
);

type Mode = "signin" | "signup";

export function AuthForm({ next = "/profile" }: { next?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Server actions redirect on success, so only failures come back here.
  const run = (action: (fd: FormData) => Promise<AuthActionResult>) => (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await action(formData);
      if (result?.error) setError(result.error);
    });
  };

  const isSignUp = mode === "signup";

  return (
    <div className="space-y-5">
      <form action={run(signInWithGoogle)}>
        <input type="hidden" name="next" value={next} />
        <Button
          type="submit"
          variant="outline"
          disabled={isPending}
          className="group h-12 w-full justify-center gap-2.5 text-base"
        >
          <GoogleIcon className="transition-transform duration-300 group-hover:scale-110" />
          Continue with Google
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-3 text-xs uppercase tracking-wider text-muted-foreground">
            or
          </span>
        </div>
      </div>

      <form
        action={run(isSignUp ? signUpWithPassword : signInWithPassword)}
        className="space-y-4"
      >
        <input type="hidden" name="next" value={next} />

        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              maxLength={80}
              placeholder="Ada Lovelace"
              disabled={isPending}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={isSignUp ? 12 : undefined}
            disabled={isPending}
          />
          {isSignUp && (
            <p className="text-xs text-muted-foreground">
              At least 12 characters. Length matters more than symbols.
            </p>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" disabled={isPending} className="h-11 w-full text-base">
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              {isSignUp ? "Creating your account…" : "Signing you in…"}
            </>
          ) : isSignUp ? (
            <>
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
              Create account
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account?" : "New to blkfndr?"}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(isSignUp ? "signin" : "signup");
            setError(null);
          }}
          disabled={isPending}
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary disabled:opacity-50"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
