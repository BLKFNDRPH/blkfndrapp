"use client";

import { FilteredProjectList } from "@/components/project/FilteredProjectList";
import { useProjects } from "@/context/BlockchainContext";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SlidersHorizontal, X } from "lucide-react";
import { CategoryFilter } from "@/components/project/CategoryFilter";
import {
  ProjectFilters,
  type ProjectSortKey,
} from "@/components/project/ProjectFilters";
import { ProjectLoader } from "@/components/project/ProjectLoader";
import { AnimatePresence, motion } from "framer-motion";
import { projectCategories } from "@/lib/categories";
import { getCategoriesAction } from "@/actions/categories";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";
import {
  describeStatus,
  LEGEND_CLOSING_LINE,
  secondaryBadges,
  STATUS_LEGEND,
  TONE_CLASSES,
} from "@/lib/project-status";
import { isDollarToken } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";

/**
 * Explore: every public vault, compared in dollars.
 *
 * Filters work on the words a visitor reads, not the contract's state names:
 * the quick chips read `describeStatus`, the goal slider reads a dollar figure,
 * and "unreviewed" means BLKFNDR's listing review, never the vault.
 */

type QuickFilter = "open" | "returning" | "all";

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "open", label: "Open for stakes" },
  { key: "returning", label: "Returning money" },
  { key: "all", label: "All" },
];

/** Status keys where stakeholders are getting money back from the vault. */
const RETURNING_KEYS = new Set(["returning-money", "goal-not-reached"]);

const DEFAULT_SORT: ProjectSortKey = "popularity";

/** A vault's goal in dollars: exact for USDC, estimated for XLM, raw otherwise. */
function goalInDollars(project: Project, xlmUsd: number | null): number {
  const code = (project.currencyType || "USDC").toUpperCase();
  if (isDollarToken(code)) return project.fundingGoal;
  if (code === "XLM" && xlmUsd && xlmUsd > 0) return project.fundingGoal * xlmUsd;
  return project.fundingGoal;
}

function Legend() {
  // Both secondary badges, with the same copy the cards use.
  const badges = secondaryBadges({ status: "approved", featured: true });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          What do the labels mean?
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,26rem)] max-h-[70vh] overflow-y-auto">
        <dl className="space-y-3">
          {STATUS_LEGEND.map((status) => (
            <div key={status.key} className="grid gap-1">
              <dt>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-5",
                    TONE_CLASSES[status.tone],
                  )}
                >
                  {status.label}
                </span>
              </dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{status.tooltip}</dd>
            </div>
          ))}
          {badges.map((badge) => (
            <div key={badge.key} className="grid gap-1">
              <dt>
                <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs font-semibold leading-5 text-foreground">
                  {badge.label}
                </span>
              </dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{badge.tooltip}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t pt-3 text-xs font-medium leading-relaxed text-foreground">
          {LEGEND_CLOSING_LINE}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function ProjectsContent() {
  const { projects: visibleProjects, isLoadingProjects } = useProjects();
  const { rate } = useXlmRate();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Explore is the public catalogue. An admin, a builder or a stakeholder is
  // also sent the hidden listings they may see, but they belong in the console
  // and on the profile page — not here, where a hidden listing showing up for
  // the admin who just hid it would read as the hide having failed.
  const allProjects = useMemo(
    () =>
      visibleProjects.filter(
        (p) => !p.restriction?.hidden && p.status !== "rejected" && p.status !== "hidden",
      ),
    [visibleProjects],
  );

  // Mirrors the admin-managed list so a category added in settings shows up as
  // a filter here too. Falls back to the compiled-in list if the fetch fails.
  const [knownCategories, setKnownCategories] = useState<string[]>(projectCategories);

  useEffect(() => {
    let cancelled = false;
    getCategoriesAction().then((res) => {
      if (!cancelled && res.success && res.categories?.length) {
        setKnownCategories(res.categories);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const searchQuery = searchParams.get("q");

  const maxGoal = useMemo(() => {
    if (allProjects.length === 0) return 50_000;
    return Math.max(...allProjects.map((p) => goalInDollars(p, rate)));
  }, [allProjects, rate]);

  const [sortBy, setSortBy] = useState<ProjectSortKey>(DEFAULT_SORT);
  const [goalFilter, setGoalFilter] = useState<number>(maxGoal);
  const [showUnreviewed, setShowUnreviewed] = useState(false);
  const [hasUserAdjustedGoal, setHasUserAdjustedGoal] = useState(false);

  useEffect(() => {
    if (!hasUserAdjustedGoal) {
      setGoalFilter(maxGoal);
    }
  }, [maxGoal, hasUserAdjustedGoal]);

  const handleGoalFilterChange = (value: number) => {
    setHasUserAdjustedGoal(true);
    setGoalFilter(value);
  };

  const sortedCategories = useMemo(() => {
    const categoryCounts: { [key: string]: number } = {};
    allProjects.forEach((project) => {
      if (project.category) {
        categoryCounts[project.category] =
          (categoryCounts[project.category] || 0) + 1;
      }
    });

    return [...knownCategories].sort((a, b) => {
      const countA = categoryCounts[a] || 0;
      const countB = categoryCounts[b] || 0;
      if (countA !== countB) return countB - countA;
      return a.localeCompare(b);
    });
  }, [allProjects, knownCategories]);

  const handleClearSearch = () => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("q");
    const qs = newParams.toString();
    router.push(qs ? `/projects?${qs}` : "/projects");
  };

  const handleClearFilters = () => {
    setQuickFilter("all");
    setSelectedCategory(null);
    setSortBy(DEFAULT_SORT);
    setShowUnreviewed(false);
    setHasUserAdjustedGoal(false);
    setGoalFilter(maxGoal);
    if (searchQuery) handleClearSearch();
  };

  const filteredProjects = useMemo(() => {
    const now = Date.now();
    let list = allProjects;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (project) =>
          project.title.toLowerCase().includes(q) ||
          project.tagline.toLowerCase().includes(q) ||
          project.description.toLowerCase().includes(q),
      );
    }

    if (selectedCategory) {
      list = list.filter((project) => project.category === selectedCategory);
    }

    list = list.filter((project) => {
      if (project.status === "pending" && !showUnreviewed) return false;
      if (goalInDollars(project, rate) > goalFilter) return false;
      if (quickFilter === "all") return true;
      const key = describeStatus(project, now).key;
      return quickFilter === "open" ? key === "open" : RETURNING_KEYS.has(key);
    });

    const sorted = [...list];
    switch (sortBy) {
      case "latest":
        sorted.sort(
          (a, b) =>
            new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        );
        break;
      case "ending": {
        // Soonest deadline first; vaults with no deadline, or one already
        // passed, go to the end so "ending soon" means what it says.
        const rank = (p: Project) =>
          p.fundingDeadline && p.fundingDeadline > now
            ? p.fundingDeadline
            : Number.POSITIVE_INFINITY;
        sorted.sort((a, b) => rank(a) - rank(b));
        break;
      }
      case "popularity":
      default:
        sorted.sort((a, b) => b.currentFunding - a.currentFunding);
        break;
    }

    return sorted;
  }, [
    allProjects,
    searchQuery,
    selectedCategory,
    sortBy,
    goalFilter,
    showUnreviewed,
    quickFilter,
    rate,
  ]);

  const filters = (
    <ProjectFilters
      sortBy={sortBy}
      onSortByChange={setSortBy}
      goalFilter={goalFilter}
      onGoalFilterChange={handleGoalFilterChange}
      maxGoal={maxGoal}
      showUnreviewed={showUnreviewed}
      onShowUnreviewedChange={setShowUnreviewed}
      embedded={!isDesktop}
    />
  );

  return (
    <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8" suppressHydrationWarning>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-headline text-4xl font-bold tracking-tight text-accent">
            Projects
          </h1>
          <Legend />
          {searchQuery && (
            <div className="flex items-center gap-2">
              <p className="text-md text-muted-foreground">
                Results for{" "}
                <span className="font-semibold text-foreground">“{searchQuery}”</span>
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full"
                onClick={handleClearSearch}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear search</span>
              </Button>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => setIsFilterVisible(!isFilterVisible)}
          aria-expanded={isFilterVisible}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>

      <div
        role="radiogroup"
        aria-label="Show"
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0"
      >
        {QUICK_FILTERS.map((option) => {
          const selected = quickFilter === option.key;
          return (
            <Button
              key={option.key}
              type="button"
              size="sm"
              role="radio"
              aria-checked={selected}
              variant={selected ? "secondary" : "ghost"}
              className={cn(
                "h-8 shrink-0 rounded-full px-3",
                selected && "font-semibold",
              )}
              onClick={() => setQuickFilter(option.key)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>

      {isDesktop ? (
        <AnimatePresence>
          {isFilterVisible && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -20 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0, y: -20 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              {filters}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <Sheet open={isFilterVisible} onOpenChange={setIsFilterVisible}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
            <SheetHeader className="text-left">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Sort the list and set a goal ceiling in dollars.</SheetDescription>
            </SheetHeader>
            <div className="py-4">{filters}</div>
            <Button className="w-full" onClick={() => setIsFilterVisible(false)}>
              Show {filteredProjects.length}{" "}
              {filteredProjects.length === 1 ? "project" : "projects"}
            </Button>
          </SheetContent>
        </Sheet>
      )}

      <div className="my-6">
        <CategoryFilter
          categories={sortedCategories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      </div>

      <FilteredProjectList
        projects={filteredProjects}
        isLoading={isLoadingProjects}
        onClearFilters={handleClearFilters}
      />
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="mb-6 font-headline text-4xl font-bold tracking-tight text-accent">
            Projects
          </h1>
          <ProjectLoader />
        </div>
      }
    >
      <ProjectsContent />
    </Suspense>
  );
}
