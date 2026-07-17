"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, AlertCircle, Loader2 } from 'lucide-react';
import { useAdminStatus } from '@/context/BlockchainContext';
import Loading from '../loading';
import TextPressure from '@/components/layout/TextPressure';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { useFreighterWallet } from '@/context/FreighterWalletContext';

export default function AdminPage() {
  const { freighterWalletAddress, login: freighterLogin, error: freighterError } = useFreighterWallet();
  const { platformInfo, isLoadingPlatform } = useAdminStatus(freighterWalletAddress ?? undefined);
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);

  const isLoading = isLoadingPlatform;

  const hasAdminAccess = platformInfo && freighterWalletAddress && (
    platformInfo.admin === freighterWalletAddress ||
    platformInfo.multiSigAdmins.some(
      (a: string) => a === freighterWalletAddress
    )
  );

  const handleFreighterLogin = async () => {
    setIsConnecting(true);
    try {
      await freighterLogin();
    } catch (err) {
      console.error("[AdminPage] Freighter login failed:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const isExtensionNotInstalledError = freighterError?.includes(
    "extension is not installed",
  );

  if (isLoading) {
    return <Loading />;
  }

  if (freighterWalletAddress && hasAdminAccess) {
    const isMainAdmin = platformInfo?.admin === freighterWalletAddress;
    return (
      <div className="container mx-auto py-8">
        <AdminDashboard 
          initialAdminAccessInfo={{ hasAdminAccess: true, isMainAdmin }}
        />
      </div>
    );
  }

  if (!freighterWalletAddress) {
    return (
      <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-32 w-full items-start justify-center">
              <TextPressure
                text="BLKFNDR"
                minFontSize={24}
                stroke={true}
                strokeWidth={1}
              />
            </div>
            <CardTitle className="text-2xl font-headline">Admin Access</CardTitle>
            <CardDescription>
              Please connect your Freighter wallet to access the administrator dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              onClick={handleFreighterLogin} 
              disabled={isConnecting}
              className="w-full"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" /> Connect Freighter Wallet
                </>
              )}
            </Button>
            {freighterError && (
              <div className="flex flex-col items-start space-y-2 text-xs bg-red-950/20 border border-red-900/30 p-3 rounded-lg">
                <div className="flex items-start space-x-2 w-full">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                  <span className="text-red-400">{freighterError}</span>
                </div>
                {isExtensionNotInstalledError && (
                  <Button
                    onClick={() =>
                      window.open("https://freighter.app", "_blank")
                    }
                    variant="outline"
                    size="sm"
                    className="w-full border-red-900/50 hover:border-red-800 bg-red-950/30 hover:bg-red-950/50 text-red-300 hover:text-red-200 transition-all"
                  >
                    Install Freighter Wallet
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-32 w-full items-start justify-center">
            <TextPressure
              text="BLKFNDR"
              minFontSize={24}
              stroke={true}
              strokeWidth={1}
              interactive={false}
            />
          </div>
          <CardTitle className="text-2xl font-headline">Access Denied</CardTitle>
          <CardDescription>
            Your connected wallet address ({freighterWalletAddress.slice(0, 6)}...{freighterWalletAddress.slice(-6)}) is not authorized to view the admin dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => router.push("/")} className="w-full">
            Return Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
