"use client";

import Link from "next/link";
import { AuthButton } from "@/components/auth/AuthButton";
import { BrandMark } from "./BrandMark";
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
  ListOrdered,
  Shield,
  ChevronsRight,
  HandCoins,
  FolderKanban,
  Settings,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PcbPattern } from "./PcbPattern";
import { Avatar, AvatarImage, AvatarFallback } from "../ui/avatar";
import { Separator } from "../ui/separator";
import { projectHref } from "@/lib/project-href";
import { resizedImageUrl } from "@/lib/project-image";
import dynamic from "next/dynamic";
import { NotificationBell } from "./NotificationBell";
import { HeaderSearch } from "./HeaderSearch";
import {
  useProjects,
  useUserFunds,
  useAdminStatus,
} from "@/context/BlockchainContext";
import { WalletButton } from "../auth/WalletButton";
import StaticBLKFNDR from "./StaticBLKFNDR";
import { useFreighterWallet } from "@/context/FreighterWalletContext";
import type { Project } from "@/lib/types";

// Only the open menu shows the theme switch, and it brings zod,
// react-hook-form and the radio group with it (about 27 KB compressed) that
// nothing else on most pages needs, so it loads when the menu first opens
// rather than with every page. It rendered nothing until mounted anyway.
const AppearanceSettings = dynamic(
  () => import("../settings/AppearanceSettings").then((m) => m.AppearanceSettings),
  { ssr: false },
);

/** The three places a visitor can go, in the order the brief puts them. */
const NAV_LINK_CLASS =
  "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-foreground";

type RippleHandler = (
  e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement | HTMLDivElement>,
) => void;

const handleRippleEffect: RippleHandler = (e) => {
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

/**
 * The menu's Admin row. It reads the wallet and the platform settings, so it
 * lives in the open menu: the header itself no longer re-renders when they
 * load.
 */
function MenuAdminLink({ isActive, onClose }: { isActive: boolean; onClose: () => void }) {
  const { freighterWalletAddress } = useFreighterWallet();
  const { hasAdminAccess } = useAdminStatus(freighterWalletAddress ?? undefined);
  if (!hasAdminAccess) return null;
  return (
    <Link
      href="/admin"
      onClick={onClose}
      className={cn(
        "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
        isActive ? "active" : "",
      )}
      onMouseMove={handleRippleEffect}
    >
      <Shield className="h-5 w-5" aria-hidden="true" />
      <span>Admin</span>
      {isActive && <span className="ripple-active-background"></span>}
      <span className="ripple-span"></span>
    </Link>
  );
}

/**
 * The menu's "Your stakes" and "Your projects" lists, for a signed-in person.
 * They read the project list and the wallet's stakes, which load after the
 * page does; kept in the open menu, those loads no longer re-render the
 * header on every page.
 */
function MenuYourLists({ uid, onClose }: { uid: string; onClose: () => void }) {
  const { freighterWalletAddress } = useFreighterWallet();
  const { projects } = useProjects();
  const { userFunds } = useUserFunds(freighterWalletAddress ?? undefined);

  const latestProjects = projects
    .filter((p) => p.creatorId === uid)
    .sort(
      (a, b) =>
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime(),
    )
    .slice(0, 3);
  const stakedProjectIds = userFunds.map((inv) => inv.project_id);
  const latestStaked = projects
    .filter((p) => stakedProjectIds.includes(p.id))
    .slice(0, 3);

  /** A project row in the lists: a link to the project's page. */
  const renderProjectRow = (project: Project) => (
    <Link
      key={project.id}
      href={projectHref(project.id)}
      onClick={onClose}
      className="flex items-center gap-3 p-2 rounded-md text-md h-12 hover:bg-secondary menu-item-ripple"
      onMouseMove={handleRippleEffect}
    >
      <Avatar className="h-7 w-7 border-2 border-primary/50">
        <AvatarImage
          src={resizedImageUrl(project.imageUrl, 64)}
          alt={project.title}
          className="object-cover"
        />
        <AvatarFallback>{project.title.charAt(0)}</AvatarFallback>
      </Avatar>
      <span className="truncate">{project.title}</span>
      <span className="ripple-span"></span>
    </Link>
  );

  return (
    <>
      <Separator className="my-4" />
      <div className="relative z-10">
        <Link
          href="/profile?tab=funded"
          onClick={onClose}
          className="mb-2 flex items-center gap-2 px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <HandCoins className="h-4 w-4" aria-hidden="true" />
          Your stakes
        </Link>
        <div className="flex flex-col gap-1">
          {latestStaked.map(renderProjectRow)}
          <Link
            href="/profile?tab=funded"
            onClick={onClose}
            className="flex items-center gap-3 p-2 rounded-md text-sm h-12 text-muted-foreground hover:text-foreground hover:bg-secondary menu-item-ripple"
            onMouseMove={handleRippleEffect}
          >
            <ChevronsRight className="h-5 w-5" aria-hidden="true" />
            <span>{latestStaked.length > 0 ? "Show all" : "No stakes yet"}</span>
            <span className="ripple-span"></span>
          </Link>
        </div>
      </div>

      <Separator className="my-4" />
      <div className="relative z-10">
        <Link
          href="/profile?tab=projects"
          onClick={onClose}
          className="mb-2 flex items-center gap-2 px-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <FolderKanban className="h-4 w-4" aria-hidden="true" />
          Your projects
        </Link>
        <div className="flex flex-col gap-1">
          {latestProjects.map(renderProjectRow)}
          <Link
            href="/profile?tab=projects"
            onClick={onClose}
            className="flex items-center gap-3 p-2 rounded-md text-sm h-12 text-muted-foreground hover:text-foreground hover:bg-secondary menu-item-ripple"
            onMouseMove={handleRippleEffect}
          >
            <ChevronsRight className="h-5 w-5" aria-hidden="true" />
            <span>{latestProjects.length > 0 ? "Show all" : "No projects yet"}</span>
            <span className="ripple-span"></span>
          </Link>
        </div>
      </div>
    </>
  );
}

/**
 * The site header. The server renders it as it ends up: which navigation a
 * phone or a desktop sees is CSS (the 950px breakpoint), not a media query
 * read after the page has loaded. It used to render an empty bar on the
 * server, build itself in the browser and re-render whenever the project list
 * or the wallet's stakes arrived: about 160 ms of main thread on a throttled
 * phone, on every page. Rendered on the server, with those lists in the open
 * menu, it is about 60 ms.
 */
export default function Header() {
  const { user, login } = useAuth();
  const pathname = usePathname();
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const projectsIsActive = pathname === "/projects";
  const adminIsActive = pathname === "/admin";
  const createIsActive = pathname === "/create-listing";
  const settingsIsActive = pathname === "/settings";

  const closeSheet = () => setIsSheetOpen(false);

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
          // Search opens this way only from the phone's search button.
          isSearchOpen ? "flex" : "grid grid-cols-[1fr_auto_1fr]",
        )}
      >
        {isSearchOpen ? (
          <HeaderSearch
            variant="mobile"
            isMobileOpen={isSearchOpen}
            setMobileOpen={setIsSearchOpen}
          />
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1 sm:gap-2">
              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="default"
                    size="icon"
                    className="rounded-full nav-button shrink-0"
                    onClick={() => setIsSheetOpen(true)}
                  >
                    <Menu className="h-6 w-6" aria-hidden="true" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-full max-w-xs flex-col overflow-y-auto p-6 pr-6"
                  onMouseLeave={closeSheet}
                >
                  <SheetTitle className="sr-only">Main menu</SheetTitle>
                  <PcbPattern className="text-gray-400/50 dark:text-gray-600/50 opacity-10" />
                  <Link
                    href="/"
                    className="mr-6 flex items-center space-x-2 mb-6"
                    onClick={closeSheet}
                  >
                    <BrandMark />
                    <div className="text-xl">
                      <StaticBLKFNDR className="-mt-2" />
                    </div>
                  </Link>
                  <nav className="flex flex-col gap-1 relative z-10" aria-label="Main">
                    <Link
                      href="/projects"
                      onClick={closeSheet}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                        projectsIsActive ? "active" : "",
                      )}
                      onMouseMove={handleRippleEffect}
                    >
                      <LayoutGrid className="h-5 w-5" aria-hidden="true" />
                      <span>Projects</span>
                      {projectsIsActive && (
                        <span className="ripple-active-background"></span>
                      )}
                      <span className="ripple-span"></span>
                    </Link>

                    <Link
                      href="/#how-it-works"
                      onClick={closeSheet}
                      className="flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple"
                      onMouseMove={handleRippleEffect}
                    >
                      <ListOrdered className="h-5 w-5" aria-hidden="true" />
                      <span>How it works</span>
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
                        variant="menu"
                        className="text-lg gap-4"
                        onAfterClick={closeSheet}
                      />
                      {createIsActive && (
                        <span className="ripple-active-background"></span>
                      )}
                      <span className="ripple-span"></span>
                    </div>

                    <MenuAdminLink isActive={adminIsActive} onClose={closeSheet} />
                  </nav>

                  {user && <MenuYourLists uid={user.uid} onClose={closeSheet} />}

                  <Separator className="my-4" />
                  <Link
                    href="/settings"
                    onClick={closeSheet}
                    className={cn(
                      "relative z-10 flex items-center gap-4 p-3 rounded-md text-lg h-12 menu-item-ripple",
                      settingsIsActive ? "active" : "",
                    )}
                    onMouseMove={handleRippleEffect}
                  >
                    <Settings className="h-5 w-5" aria-hidden="true" />
                    <span>Settings</span>
                    {settingsIsActive && (
                      <span className="ripple-active-background"></span>
                    )}
                    <span className="ripple-span"></span>
                  </Link>

                  <Separator className="my-4" />
                  <div className="relative z-10 appearance-section">
                    <h3 className="px-3 text-sm font-semibold text-muted-foreground mb-2">
                      Appearance
                    </h3>
                    <div className="px-3">
                      <AppearanceSettings isMenu={true} />
                    </div>
                  </div>

                  {!user && (
                    <div className="relative z-10 mt-auto pt-6">
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          closeSheet();
                          login();
                        }}
                      >
                        Sign in
                      </Button>
                    </div>
                  )}
                </SheetContent>
              </Sheet>

              <nav
                aria-label="Primary"
                className="hidden min-w-0 items-center gap-1 min-[950px]:flex"
              >
                <Link
                  href="/projects"
                  className={cn(
                    NAV_LINK_CLASS,
                    projectsIsActive
                      ? "bg-secondary text-foreground"
                      : "text-foreground/70",
                  )}
                >
                  Projects
                </Link>
                <Link
                  href="/#how-it-works"
                  className={cn(NAV_LINK_CLASS, "text-foreground/70")}
                >
                  How it works
                </Link>
                <CreateListingButton variant="nav" />
              </nav>
              <div className="min-[950px]:hidden">
                <HeaderSearch
                  variant="mobile"
                  isMobileOpen={isSearchOpen}
                  setMobileOpen={setIsSearchOpen}
                />
              </div>
            </div>

            {/* The wordmark used to be hidden below 490px and collapsed to zero
                width on scroll, which meant the site never showed its own name
                on a phone, and stopped showing it on desktop the moment you
                scrolled — leaving a bare icon carrying the whole brand. It
                stays put now and scales instead; the group is a flex row, so it
                stays centred at any size. Opening search on a phone replaces
                the whole bar, the one case where the space is genuinely needed. */}
            <div className="flex items-center justify-center justify-self-center">
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <BrandMark />
                <div className="text-base sm:text-xl">
                  <StaticBLKFNDR className="-mt-2" />
                </div>
              </Link>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end">
              {/*
                Desktop only, by CSS. HeaderSearch sizes itself to 30% of its
                container on desktop; here the container is this flex item, so
                the field fills the room the other controls leave rather than a
                fixed slice of it.
              */}
              <div className="hidden min-w-0 max-w-xs flex-1 min-[950px]:block [&_.header-search-container]:w-full">
                <HeaderSearch variant="desktop" />
              </div>
              {user && <NotificationBell />}
              {user && <WalletButton />}
              <AuthButton />
            </div>
          </>
        )}
      </div>
    </header>
  );
}
