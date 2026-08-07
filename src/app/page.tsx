"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Lock, Users } from "lucide-react";

import { ProjectList } from "@/components/project/ProjectList";
import { ProjectLoader } from "@/components/project/ProjectLoader";
import type { Project } from "@/lib/types";
import { CityScape } from "@/components/layout/CityScape";
import { StellarLogo } from "@/components/layout/StellarLogo";
import TextPressure from "@/components/layout/TextPressure";
import { useProjects, usePlatformInfo } from "@/context/BlockchainContext";
import { Button } from "@/components/ui/button";

import { BlueprintGrid } from "@/components/home/BlueprintGrid";
import { BondedVaultAnimation } from "@/components/home/BondedVaultAnimation";
import { AboutSection } from "@/components/home/AboutSection";
import { FeaturesSection } from "@/components/home/FeaturesSection";
import { SecuritySection } from "@/components/home/SecuritySection";
import { ContactSection } from "@/components/home/ContactSection";

const HERO_CHIPS = [
  { icon: Lock, label: "Builder bond locked in the same contract" },
  { icon: Users, label: "Tranches released by contributor vote" },
  { icon: ShieldCheck, label: "No admin key in the money path" },
];

const SECTION_LINKS = [
  { href: "#about", label: "About" },
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
  { href: "#contact", label: "Contact" },
];

export default function Home() {
  const { projects, isLoadingProjects } = useProjects();
  const { isLoadingPlatform } = usePlatformInfo();

  const [featuredProjects, setFeaturedProjects] = useState<Project[]>([]);

  const isLoading = isLoadingProjects || isLoadingPlatform;

  useEffect(() => {
    if (isLoading) return;

    const approvedProjects = projects.filter(
      (p) =>
        p.status === "funded" ||
        p.status === "completed" ||
        p.status === "featured" ||
        p.status === "raising" ||
        p.status === "active" ||
        p.status === "failed" ||
        p.status === "refunding",
    );

    const sorted = [...approvedProjects].sort((a, b) => {
      const aProgress = (a.currentFunding / a.fundingGoal) * 100;
      const bProgress = (b.currentFunding / b.fundingGoal) * 100;

      if (bProgress !== aProgress) {
        return bProgress - aProgress;
      }
      return (new Date(b.createdAt!) as any) - (new Date(a.createdAt!) as any);
    });

    setFeaturedProjects(sorted.slice(0, 12));
  }, [projects, isLoading]);

  return (
    <div className="flex-1">
      {/* ---------- Above the fold ---------- */}
      <section className="hero-dark relative flex min-h-[100svh] flex-col justify-center overflow-hidden bg-gradient-to-br from-black via-neutral-950 to-black">
        <BlueprintGrid />

        <div className="container relative z-10 mx-auto px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          {/*
            minmax(0,...) tracks and min-w-0 on the items are load-bearing here.
            TextPressure sizes its font from its container width, so with the
            default `min-width: auto` its own intrinsic width stretches the
            column back out — which pushed the paragraph and CTAs past the
            section's overflow-hidden edge on narrow screens.
          */}
          <div className="grid items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-8">
            {/* Copy */}
            <div className="min-w-0 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-foreground/90">
                <StellarLogo className="h-4 w-4 fill-current text-foreground" />
                Built on Stellar &amp; Soroban
                <span className="mx-1 h-1 w-1 rounded-full bg-accent/60" />
                Live on testnet
              </div>

              {/*
                Decorative: TextPressure renders its own <h1> of one span per
                letter, which a screen reader spells out and which would compete
                with the real page heading below. The brand name is already in
                the document title and the header.
              */}
              <div
                aria-hidden="true"
                className="mt-6 flex h-24 items-start justify-center sm:h-32 md:h-40 lg:justify-start"
              >
                <TextPressure
                  text="BLKFNDR"
                  minFontSize={24}
                  stroke={true}
                  strokeWidth={1}
                  textColor="white"
                  strokeColor="white"
                />
              </div>

              <h1 className="mt-2 font-headline text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl md:text-4xl">
                Build, fund and own real-world developments on the blockchain.
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-foreground/70 sm:text-lg lg:mx-0">
                Contributions pool into a per-project vault. The builder&apos;s
                performance bond is locked in the same contract. Milestone
                tranches are released only when contributors vote to release
                them — and a milestone that fails forfeits the bond to the people
                who funded it.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button
                  asChild
                  size="lg"
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"
                >
                  <Link href="/projects">
                    Browse live projects
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="w-full border-foreground/25 bg-foreground/5 text-foreground hover:bg-foreground/10 hover:text-foreground sm:w-auto"
                >
                  <Link href="#security">How your money is protected</Link>
                </Button>
              </div>

              <ul className="mt-8 flex flex-col items-center gap-2.5 lg:items-start">
                {HERO_CHIPS.map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="flex items-center gap-2.5 text-sm text-foreground/70"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-accent" />
                    {label}
                  </li>
                ))}
              </ul>
            </div>

            {/* The mechanic, animated */}
            <div className="flex min-w-0 justify-center lg:justify-end">
              <BondedVaultAnimation />
            </div>
          </div>

          <nav className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-foreground/10 pt-6 lg:justify-start">
            {SECTION_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-medium text-foreground/60 transition-colors hover:text-accent"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* ---------- Featured projects ---------- */}
      <div className="relative z-20 bg-card">
        <CityScape />
        <section className="-mt-12 pb-20 pt-8 lg:-mt-14">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <h2 className="font-headline text-2xl font-bold tracking-tight text-accent sm:text-3xl md:text-4xl">
                Featured Projects
              </h2>
              <p className="mt-2 text-base text-muted-foreground sm:text-lg">
                Developments raising right now, each one behind its own bonded
                vault.
              </p>
            </div>
            {isLoading ? (
              <ProjectLoader />
            ) : (
              <ProjectList
                projects={featuredProjects}
                onlyShowCompletedStatus={true}
              />
            )}
          </div>
        </section>
      </div>

      {/* ---------- Content ---------- */}
      <AboutSection />
      <FeaturesSection />
      <SecuritySection />
      <ContactSection />
    </div>
  );
}
