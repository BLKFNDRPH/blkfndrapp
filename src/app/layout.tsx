import type { Metadata } from "next";
import { Inter, Source_Code_Pro } from "next/font/google";
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

// Self-hosted by next/font: downloaded at build time and served from this
// origin with a preload, instead of a render-blocking stylesheet from
// fonts.googleapis.com that held up the first paint by about 0.9 s on a
// throttled phone. The variables feed the Tailwind font families.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-code",
});

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
    <html
      lang="en"
      className={cn(inter.variable, sourceCodePro.variable)}
      suppressHydrationWarning
    >
      <head>
        {/*
          Inter and Source Code Pro come from next/font (above). The wordmark
          font is self-hosted from public/fonts and declared in globals.css.
        */}
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
