
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DisplayNameForm } from "@/components/settings/DisplayNameForm";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { WalletSettings } from "@/components/settings/WalletSettings";

export default function SettingsPage() {
  return (
    <div className="container mx-auto max-w-3xl py-12">
      <div className="space-y-4 mb-8">
        <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">Settings</h1>
        <p className="text-muted-foreground text-lg">
          Manage your account, appearance, and wallet preferences.
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

        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
            <CardDescription>
              View your connected Freighter wallet details.
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
