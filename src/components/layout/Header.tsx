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
        <div className="container flex h-14 max-w-screen-2xl items-center" />
      </header>
    );
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-colors duration-300",
        isScrolled
          ? "border-b border-transparent bg-transparent"
          : "border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
      )}
    >
      <div className="container flex h-14 max-w-screen-2xl items-center justify-between gap-2">
        {!isDesktop && isSearchOpen ? (
          <HeaderSearch
            isMobileOpen={isSearchOpen}
            setMobileOpen={setIsSearchOpen}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 flex-grow">
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

            <div
              className={cn(
                "absolute left-1/2 top-1/2 -translate-y-1/2 flex items-center justify-center transition-all duration-500 ease-in-out",
                isScrolled
                  ? "-translate-x-1/2"
                  : "-translate-x-1/2 min-[490px]:-translate-x-[60%]",
                !isDesktop && isSearchOpen && "opacity-0 pointer-events-none",
              )}
            >
              <Link href="/" className="flex items-center space-x-2">
                <div
                  className={cn(
                    "transition-transform duration-500 ease-in-out",
                    isScrolled ? "translate-x-0" : "translate-x-0",
                  )}
                >
                  <CubeAvatar />
                </div>
                <div
                  className={cn(
                    "transition-opacity duration-500 ease-in-out overflow-hidden hidden min-[490px]:block",
                    isScrolled ? "opacity-0 w-0" : "opacity-100 w-auto ml-3",
                  )}
                >
                  <div className="text-xl">
                    <StaticBLKFNDR className="-mt-2" />
                  </div>
                </div>
              </Link>
            </div>

            <div className="flex items-center justify-end gap-2">
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
