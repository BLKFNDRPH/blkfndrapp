"use client";

import Link from "next/link";
import { AuthButton } from "@/components/auth/AuthButton";
import { CubeAvatar } from "./CubeAvatar";
import { CreateListingButton } from "./CreateListingButton";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Menu,
  LayoutGrid,
  PlusSquare,
  Shield,
  TestTube,
  ChevronsRight,
  Heart,
  BanknoteArrowDown,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Project, Investment } from "@/lib/types";
import { PcbPattern } from "./PcbPattern";
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar";
import { Separator } from "../ui/separator";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { AppearanceSettings } from "../settings/AppearanceSettings";
import { NotificationBell } from "./NotificationBell";
import { HeaderSearch } from "./HeaderSearch";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  useProjects,
  useUserFunds,
  useAdminStatus,
} from "@/context/BlockchainContext";
import { WalletButton } from "../auth/WalletButton";
import StaticBLKFNDR from "./StaticBLKFNDR";
import { useFreighterWallet } from "@/context/FreighterWalletContext";

export default function Header() {
  const { user } = useAuth();
  const { freighterWalletAddress } = useFreighterWallet();
  const { hasAdminAccess } = useAdminStatus(
    freighterWalletAddress ?? undefined,
  );
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const { openProjectDetails } = useProjectDetails();
  const { projects } = useProjects();
  const { userFunds } = useUserFunds(
    freighterWalletAddress ?? undefined,
  );
  const isDesktop = useMediaQuery("(min-width: 950px)");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const userProjects = projects
    .filter((p) => p.creatorId === user?.uid)
    .sort(
      (a, b) =>
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime(),
    );

  const fundedProjectIds = userFunds.map((inv) => inv.project_id);
  const fundedProjects = projects.filter((p) =>
    fundedProjectIds.includes(p.id),
  );

  useEffect(() => {
    setIsClient(true);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleRippleEffect = (
    e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement | HTMLDivElement>,
  ) => {
    const target = e.currentTarget as HTMLElement;
    let ripple = target.querySelector(".ripple-span") as HTMLElement;
    if (!ripple) {
      ripple = document.createElement("span");
      ripple.className = "ripple-span";
      target.appendChild(ripple);
    }

    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
  };

  const projectsIsActive = pathname === "/projects";
  const adminIsActive = pathname === "/admin";
  const createIsActive = pathname === "/create-listing";
  const testingIsActive = pathname === "/testing/stellar";
  const latestProjects = userProjects.slice(0, 3);
  const latestFunded = fundedProjects.slice(0, 3);

  if (!isClient) {
    // Render a placeholder or nothing on the server to avoid hydration mismatch
    return (
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center" />
      </header>
    );
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-300",
        // These were the wrong way round: opaque at rest, transparent once
        // scrolled. A sticky header with no background is a header the page
        // scrolls straight through, so headings collided with the wordmark on
        // every page. Transparent at the top lets the hero read as one piece;
        // the backdrop arrives when there is content passing underneath.
        isScrolled
          ? "border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div
        className={cn(
          // max-w-screen-2xl is gone on purpose. It is a utility, so it beat the
          // container component's own 1400px cap and made this bar 1536px wide
          // while every page stayed at 1400 -- 68px of misalignment per side at
          // a 1700px viewport, closing to nothing once the viewport dropped
          // below both caps, which is why the offset appeared to move with the
          // window. One width rule is what keeps header and page in step.
          "container h-14 items-center gap-2",
          // Three real tracks rather than a centred overlay. The wordmark was
          // position:absolute, so it took part in no layout and nothing stopped
          // a side group growing underneath it. Equal 1fr sides hold it dead
          // centre whatever those sides contain, and make overlap impossible.
          !isDesktop && isSearchOpen ? "flex" : "grid grid-cols-[1fr_auto_1fr]",
        )}
      >
        {!isDesktop && isSearchOpen ? (
          <HeaderSearch
            isMobileOpen={isSearchOpen}
            setMobileOpen={setIsSearchOpen}
          />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="default"
                    size="icon"
                    className="rounded-full nav-button"
                    onClick={() => setIsSheetOpen(true)}
                  >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-full max-w-xs p-6 pr-6 overflow-y-auto"
                  onMouseLeave={() => setIsSheetOpen(false)}
                >
                  <SheetTitle className="sr-only">Main Menu</SheetTitle>
                  <PcbPattern className="text-gray-400/50 dark:text-gray-600/50 opacity-10" />
                  <Link
                    href="/"
                    className="mr-6 flex items-center space-x-2 mb-6"
                    onClick={() => setIsSheetOpen(false)}
                  >
                    <CubeAvatar />
                    <div className="text-xl">
                      <StaticBLKFNDR className="-mt-2" />
                    </div>
                  </Link>
                  <nav className="flex flex-col gap-1 relative z-10">
                    <Link
                      href="/projects"
                      onClick={() => setIsSheetOpen(false)}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                        projectsIsActive ? "active" : "",
                      )}
                      onMouseMove={handleRippleEffect}
                    >
                      <LayoutGrid className="h-5 w-5" />
                      <span>Projects</span>
                      {projectsIsActive && (
                        <span className="ripple-active-background"></span>
                      )}
                      <span className="ripple-span"></span>
                    </Link>

                    <div
                      onMouseMove={handleRippleEffect}
                      className={cn(
                        "flex items-center p-3 rounded-md text-lg h-12 menu-item-ripple w-full cursor-pointer",
                        createIsActive ? "active" : "",
                      )}
                    >
                      <CreateListingButton
                        className="text-lg gap-4"
                        onAfterClick={() => setIsSheetOpen(false)}
                      />
                      {createIsActive && (
                        <span className="ripple-active-background"></span>
                      )}
                      <span className="ripple-span"></span>
                    </div>

                    {hasAdminAccess && (
                      <>
                        <Link
                          href="/admin"
                          onClick={() => setIsSheetOpen(false)}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                            adminIsActive ? "active" : "",
                          )}
                          onMouseMove={handleRippleEffect}
                        >
                          <Shield className="h-5 w-5" />
                          <span>Admin</span>
                          {adminIsActive && (
                            <span className="ripple-active-background"></span>
                          )}
                          <span className="ripple-span"></span>
                        </Link>
                        <Link
                          href="/admin/withdrawals"
                          onClick={() => setIsSheetOpen(false)}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                            adminIsActive ? "active" : "",
                          )}
                          onMouseMove={handleRippleEffect}
                        >
                          <BanknoteArrowDown className="h-5 w-5" />
                          <span>Withdrawal Proposals</span>
                          {adminIsActive && (
                            <span className="ripple-active-background"></span>
                          )}
                          <span className="ripple-span"></span>
                        </Link>
                        <Link
                          href="/testing/stellar"
                          onClick={() => setIsSheetOpen(false)}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                            testingIsActive ? "active" : "",
                          )}
                          onMouseMove={handleRippleEffect}
                        >
                          <TestTube className="h-5 w-5" />
                          <span>Testing</span>
                          {testingIsActive && (
                            <span className="ripple-active-background"></span>
                          )}
                          <span className="ripple-span"></span>
                        </Link>
                      </>
                    )}
                  </nav>
                  {user && latestProjects.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <div className="relative z-10">
                        <h3 className="px-3 text-sm font-semibold text-muted-foreground mb-2">
                          My Projects
                        </h3>
                        <div className="flex flex-col gap-1">
                          {latestProjects.map((project) => (
                            <div
                              key={project.id}
                              onClick={() => {
                                openProjectDetails(project);
                                setIsSheetOpen(false);
                              }}
                              className="flex items-center gap-3 p-2 rounded-md text-md h-12 hover:bg-secondary menu-item-ripple cursor-pointer"
                              onMouseMove={handleRippleEffect}
                            >
                              <Avatar className="h-7 w-7 border-2 border-primary/50">
                                <AvatarImage
                                  src={project.imageUrl}
                                  alt={project.title}
                                  className="object-cover"
                                />
                                <AvatarFallback>
                                  {project.title.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">{project.title}</span>
                              <span className="ripple-span"></span>
                            </div>
                          ))}
                          <Link
                            href="/profile?tab=projects"
                            onClick={() => setIsSheetOpen(false)}
                            className="flex items-center gap-3 p-2 rounded-md text-sm h-12 text-muted-foreground hover:text-foreground hover:bg-secondary menu-item-ripple"
                            onMouseMove={handleRippleEffect}
                          >
                            <ChevronsRight className="h-5 w-5" />
                            <span>Show All</span>
                            <span className="ripple-span"></span>
                          </Link>
                        </div>
                      </div>
                    </>
                  )}
                  {user && latestFunded.length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <div className="relative z-10">
                        <h3 className="px-3 text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                          <Heart className="h-4 w-4" />
                          Funded Projects
                        </h3>
                        <div className="flex flex-col gap-1">
                          {latestFunded.map((project) => (
                            <div
                              key={project.id}
                              onClick={() => {
                                openProjectDetails(project);
                                setIsSheetOpen(false);
                              }}
                              className="flex items-center gap-3 p-2 rounded-md text-md h-12 hover:bg-secondary menu-item-ripple cursor-pointer"
                              onMouseMove={handleRippleEffect}
                            >
                              <Avatar className="h-7 w-7 border-2 border-primary/50">
                                <AvatarImage
                                  src={project.imageUrl}
                                  alt={project.title}
                                  className="object-cover"
                                />
                                <AvatarFallback>
                                  {project.title.charAt(0)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="truncate">{project.title}</span>
                              <span className="ripple-span"></span>
                            </div>
                          ))}
                          <Link
                            href="/profile?tab=funded"
                            onClick={() => setIsSheetOpen(false)}
                            className="flex items-center gap-3 p-2 rounded-md text-sm h-12 text-muted-foreground hover:text-foreground hover:bg-secondary menu-item-ripple"
                            onMouseMove={handleRippleEffect}
                          >
                            <ChevronsRight className="h-5 w-5" />
                            <span>Show All</span>
                            <span className="ripple-span"></span>
                          </Link>
                        </div>
                      </div>
                    </>
                  )}

                  <Separator className="my-4" />
                  <div className="relative z-10 appearance-section">
                    <h3 className="px-3 text-sm font-semibold text-muted-foreground mb-2">
                      Appearance
                    </h3>
                    <div className="px-3">
                      <AppearanceSettings isMenu={true} />
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
              {isDesktop ? (
                <div className="w-full">
                  <HeaderSearch />
                </div>
              ) : (
                <HeaderSearch
                  isMobileOpen={isSearchOpen}
                  setMobileOpen={setIsSearchOpen}
                />
              )}
            </div>

            {/* The wordmark used to be hidden below 490px and collapsed to zero
                width on scroll, which meant the site never showed its own name
                on a phone, and stopped showing it on desktop the moment you
                scrolled — leaving a bare icon carrying the whole brand. It
                stays put now and scales instead; the group is a flex row, so it
                stays centred at any size. Opening search on mobile still hides
                it, which is the one case where the space is genuinely needed. */}
            <div
              className={cn(
                "flex items-center justify-center justify-self-center transition-opacity duration-300 ease-in-out",
                !isDesktop && isSearchOpen && "opacity-0 pointer-events-none",
              )}
            >
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <CubeAvatar />
                <div className="text-base sm:text-xl">
                  <StaticBLKFNDR className="-mt-2" />
                </div>
              </Link>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end">
              <div className={cn("transition-opacity duration-300")}>
                {user && <NotificationBell />}
              </div>
              {user && <WalletButton />}
              <AuthButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
