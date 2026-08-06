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
  title: "BLKFNDR - Crowdfunding on Stellar",
  description:
    "The premier launchpad for innovative projects on the Stellar blockchain.",
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Code+Pro&family=Roboto+Flex:opsz,wght@8..144,100..1000&display=swap"
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
