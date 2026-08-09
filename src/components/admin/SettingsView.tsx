"use client";

import { Cog } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../ui/card";
import { FeeContactForm } from "./FeeContactForm";

/**
 * Platform settings, in the page rather than a drawer.
 *
 * This used to slide in from the side. A drawer is right for a quick, transient
 * action; it is wrong for a place you go to configure the platform and expect to
 * stay a while. It is a tab now, like everything else the console does.
 *
 * The platform fee and the performance bond used to live here as sliders. They
 * moved to Platform Governance, because they are decided by a vote rather than
 * saved by one signature — a setting you can change alone and a term the owners
 * agree on are different kinds of thing and should not share a panel.
 *
 * The integration secrets — Pinata and Resend — belong here too and land in a
 * follow-up: they go to the Supabase Vault, written but never shown back, so a
 * key can be replaced from this page without ever being readable from it.
 */
export function SettingsView() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="h-5 w-5" aria-hidden="true" />
            Settings
          </CardTitle>
          <CardDescription>
            Platform configuration. Fees and the bond are set by vote under
            Platform Governance, not here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeeContactForm />
        </CardContent>
      </Card>
    </div>
  );
}
