"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Lock, Users } from "lucide-react";

import { ProjectList } from "@/components/project/ProjectList";
import type { Project } from "@/lib/types";
import { CityScape } from "@/components/layout/CityScape";
import { StellarLogo } from "@/components/layout/StellarLogo";
import TextPressure from "@/components/layout/TextPressure";
import { useProjects, usePlatformInfo } from "@/context/BlockchainContext";
import { Button } from "@/components/ui/button";
import { IS_PRACTICE_NETWORK } from "@/lib/network";

import { BlueprintGrid } from "@/components/home/BlueprintGrid";
import { BondedVaultAnimation } from "@/components/home/BondedVaultAnimation";
import { FeaturedSkeleton } from "@/components/home/FeaturedSkeleton";
import { TakePartSection } from "@/components/home/TakePartSection";
import { AboutSection } from "@/components/home/AboutSection";
import { SecuritySection } from "@/components/home/SecuritySection";
import { PrivacySection } from "@/components/home/PrivacySection";
import { ContactSection } from "@/components/home/ContactSection";

const HERO_CHIPS = [
  { icon: Lock, label: "Money sits in the project's on-chain vault, not in a BLKFNDR account" },
  { icon: Users, label: "Stakeholders vote on every payout" },
  { icon: ShieldCheck, label: "The vault contract has no admin key: BLKFNDR can't open it" },
];

const SECTION_LINKS = [
  { href: "#take-part", label: "Take part" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#protection", label: "Protection" },
  { href: "#privacy", label: "Privacy" },
  { href: "#contact", label: "Contact" },
];

export default function Home() {
  const { projects, isLoadingProjects } = useProjects();
  const { isLoadingPlatform } = usePlatformInfo();

  const [featuredProjects, setFeaturedProjects] = useState<Project[]>([]);

  const isLoading = isLoadingProjects || isLoadingPlatform;

  useEffect(() => {
    if (isLoading) return;

    // A hidden listing is only here for an admin, its builder or a stakeholder,
    // and the home page is the public face of the platform.
    const approvedProjects = projects.filter(
      (p) =>
        !p.restriction?.hidden &&
        (p.status === "funded" ||
          p.status === "completed" ||
          p.status === "featured" ||
          p.status === "raising" ||
          p.status === "active" ||
          p.status === "failed" ||
          p.status === "refunding"),
    );

    const sorted = [...approvedProjects].sort((a, b) => {
      const aProgress = (a.currentFunding / a.fundingGoal) * 100;
      const bProgress = (b.currentFunding / b.fundingGoal) * 100;

      if (bProgress !== aProgress) {
        return bProgress - aProgress;
      }
      return (
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      );
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
                <StellarLogo
                  className="h-4 w-4 fill-current text-foreground"
                  aria-hidden="true"
                />
                Built on Stellar &amp; Soroban
                {IS_PRACTICE_NETWORK ? (
                  <>
                    <span
                      className="mx-1 h-1 w-1 rounded-full bg-accent/60"
                      aria-hidden="true"
                    />
                    Live on Testnet
                  </>
                ) : null}
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
                A vault for real-world projects. The people who stake decide
                when the builder gets paid.
              </h1>

              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-foreground/70 sm:text-lg lg:mx-0">
                Every project keeps its money in its own vault, a Soroban smart
                contract on Stellar. Nothing leaves it until the stakeholders
                vote, and the whole history is on-chain. BLKFNDR can&apos;t open
                it, and you can check that yourself.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
                <Button
                  asChild
                  size="lg"
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 sm:w-auto"
                >
                  <Link href="/projects">
                    See live projects
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="w-full border-foreground/25 bg-foreground/5 text-foreground hover:bg-foreground/10 hover:text-foreground sm:w-auto"
                >
                  <Link href="#protection">How your money is protected</Link>
                </Button>
              </div>

              <ul className="mt-8 flex flex-col items-center gap-2.5 lg:items-start">
                {HERO_CHIPS.map(({ icon: Icon, label }) => (
                  <li
                    key={label}
                    className="flex items-center gap-2.5 text-sm text-foreground/70"
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 text-accent"
                      aria-hidden="true"
                    />
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

          <nav
            aria-label="On this page"
            className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-foreground/10 pt-6 lg:justify-start"
          >
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
        <section className="-mt-12 pb-20 pt-8 lg:-mt-14" aria-labelledby="featured-heading">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <h2
                id="featured-heading"
                className="font-headline text-2xl font-bold tracking-tight text-accent sm:text-3xl md:text-4xl"
              >
                Featured projects
              </h2>
              <p className="mt-2 text-base text-muted-foreground sm:text-lg">
                Each one keeps its money in its own on-chain vault, with a
                record anyone can verify on the Stellar ledger.
              </p>
            </div>
            {isLoading ? (
              <FeaturedSkeleton />
            ) : featuredProjects.length === 0 ? (
              <p className="text-center text-muted-foreground">
                No projects yet. Check back soon, or{" "}
                <Link
                  href="/create-listing"
                  className="underline underline-offset-2 hover:text-accent"
                >
                  open a vault
                </Link>{" "}
                for your own project.
              </p>
            ) : (
              <ProjectList projects={featuredProjects} />
            )}
          </div>
        </section>
      </div>

      {/* ---------- Content ---------- */}
      <TakePartSection />
      <AboutSection />
      <SecuritySection />
      <PrivacySection />
      <ContactSection />
    </div>
  );
}
