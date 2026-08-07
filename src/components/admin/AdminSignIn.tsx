"use client";

import { Shield, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";
import { signOut } from "@/app/auth/actions";

/**
 * What a visitor sees at /admin when they are not an admin.
 *
 * Two cases, deliberately worded differently. Someone signed out is asked to
 * sign in. Someone signed in without the role is told plainly that this account
 * does not have access, and offered a way to switch accounts — telling them to
 * "sign in" when they already are is the kind of dead end that generates a
 * support ticket.
 *
 * Neither case hints at whether an admin account exists for that address, which
 * would turn this page into an oracle for who runs the platform.
 */
export function AdminSignIn({
  state,
  email,
}: {
  state: "signed-out" | "not-admin";
  email?: string | null;
}) {
  if (state === "not-admin") {
    return (
      <div className="container mx-auto flex min-h-[70vh] items-center justify-center py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
            </div>
            <CardTitle>Administrator access required</CardTitle>
            <CardDescription>
              {email ? (
                <>
                  You are signed in as <span className="font-medium">{email}</span>,
                  which is not an administrator account.
                </>
              ) : (
                <>This account is not an administrator account.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Sign in with a different account
              </Button>
            </form>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/">Back to the platform</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-[70vh] items-center justify-center py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <CardTitle>Administrator sign in</CardTitle>
          <CardDescription>
            Sign in to reach the administrator dashboard. Connecting a wallet
            happens inside, and only for actions that touch a contract.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Returns here rather than to /profile, so an admin who signed in from
              this page lands where they were going. */}
          <AuthForm next="/admin" />
        </CardContent>
      </Card>
    </div>
  );
}
