
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DisplayNameForm } from "@/components/settings/DisplayNameForm";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { EmailSettings } from "@/components/settings/EmailSettings";
import { PracticeNetworkBadge, WalletSettings } from "@/components/settings/WalletSettings";

export default function SettingsPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12">
      <div className="space-y-4 mb-8">
        <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">Settings</h1>
        <p className="text-muted-foreground text-lg">
          Your account, how the app looks, your emails and your wallet.
        </p>
      </div>
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Update your display name. This will be visible to other users.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DisplayNameForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Customize the look and feel of the application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AppearanceSettings />
          </CardContent>
        </Card>

        <Card id="email" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>
              Everything shows in the bell. Choose what we also email you, so a vote or a refund doesn&apos;t wait for your
              next visit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailSettings />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Your wallet</CardTitle>
              <PracticeNetworkBadge />
            </div>
            <CardDescription>
              The Stellar wallet you sign stakes, votes and refunds with. Its keys live on your device, not with BLKFNDR.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletSettings />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
