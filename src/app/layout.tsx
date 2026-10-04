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
import { BlockchainProvider } from "@/context/BlockchainContext";
import { FreighterWalletProvider } from "@/context/FreighterWalletProvider";
import { PracticeModeBanner } from "@/components/layout/PracticeModeBanner";

export const metadata: Metadata = {
  title: "BLKFNDR — A vault for real-world projects",
  description:
    "Every project keeps its money in its own locked vault. Nothing leaves it until the stakeholders vote, and the whole history is public. BLKFNDR can't open it, and you can check that yourself.",
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
          The wordmark font is self-hosted from public/fonts and declared in
          globals.css, so Roboto Flex is deliberately absent here.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Code+Pro&display=swap"
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
        >
          <FreighterWalletProvider>
            <AuthProvider>
              {/* Real-time updates via Stellar event subscription */}
              <BlockchainProvider>
                <ProjectDetailsProvider>
                  <div className="relative flex min-h-dvh flex-col bg-background">
                    <PracticeModeBanner />
                    <Header />
                    <main className="flex-1">{children}</main>
                    <Footer />
                  </div>
                  <Toaster />
                </ProjectDetailsProvider>
              </BlockchainProvider>
            </AuthProvider>
          </FreighterWalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
