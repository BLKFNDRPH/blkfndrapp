import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AuthProvider } from "@/context/AuthContext";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Toaster } from "@/components/ui/toaster";
import "./loading.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ProjectDetailsProvider } from "@/context/ProjectDetailsContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { BlockchainProvider } from "@/context/BlockchainContext";
import { FreighterWalletProvider } from "@/context/FreighterWalletProvider";

export const metadata: Metadata = {
  title: "BLKFNDR — Bonded crowdfunding for real-world builds, on Stellar",
  description:
    "Contributions pool into a per-project vault, the builder's performance bond is locked in the same contract, and milestone tranches are released only when contributors vote to release them. No admin key in the path that moves money.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/*
          Roboto Flex is requested with its slnt, wdth and wght axes because it
          now backs the BLKFNDR wordmark, which animates all three. Google Fonts
          only serves the axes named here — dropping one silently freezes that
          axis at its default.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Code+Pro&family=Roboto+Flex:opsz,slnt,wdth,wght@8..144,-10..0,25..151,100..1000&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={cn("min-h-screen bg-background font-body antialiased")}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >            <FreighterWalletProvider>
              <AuthProvider>
                <CurrencyProvider>
                  {/* Real-time updates via Stellar event subscription */}
                  <BlockchainProvider>
                    <ProjectDetailsProvider>
                      <div className="relative flex min-h-dvh flex-col bg-background">
                        <Header />
                        <main className="flex-1">{children}</main>
                        <Footer />
                      </div>
                      <Toaster />
                    </ProjectDetailsProvider>
                  </BlockchainProvider>
                </CurrencyProvider>
              </AuthProvider>
            </FreighterWalletProvider>        </ThemeProvider>
      </body>
    </html>
  );
}
