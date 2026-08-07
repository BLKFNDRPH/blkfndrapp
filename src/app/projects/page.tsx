"use client";

import { FilteredProjectList } from "@/components/project/FilteredProjectList";
import { useProjects } from "@/context/BlockchainContext";
import type { Project } from "@/lib/types";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X } from "lucide-react";
import { CategoryFilter } from "@/components/project/CategoryFilter";
import { ProjectFilters } from "@/components/project/ProjectFilters";
import { AnimatePresence, motion } from "framer-motion";
import { projectCategories } from "@/lib/categories";
import { getCategoriesAction } from "@/actions/categories";

function ProjectsContent() {
  const { projects: allProjects, isLoadingProjects } = useProjects();

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    "Explore",
  );

  const searchParams = useSearchParams();
  const router = useRouter();
  const searchQuery = searchParams.get("q");

  const maxGoal = useMemo(() => {
    if (allProjects.length === 0) return 100000;
    return Math.max(...allProjects.map((p) => p.fundingGoal));
  }, [allProjects, knownCategories]);

  const [sortBy, setSortBy] = useState<string>("popularity");
  const [goalFilter, setGoalFilter] = useState<number>(maxGoal);
  const [showPending, setShowPending] = useState(false);

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

    const sorted = [...knownCategories].sort((a, b) => {
      const countA = categoryCounts[a] || 0;
      const countB = categoryCounts[b] || 0;
      if (countA !== countB) return countB - countA;
      return a.localeCompare(b);
    });

    return ["Explore", ...sorted];
  }, [allProjects]);

  const handleClearSearch = () => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.delete("q");
    router.push(`/projects?${newParams.toString()}`);
  };

  const filteredProjects = useMemo(() => {
    let projectsToFilter = allProjects;

    if (searchQuery) {
      projectsToFilter = projectsToFilter.filter(
        (project) =>
          project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
          project.description.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    if (selectedCategory && selectedCategory !== "Explore") {
      projectsToFilter = projectsToFilter.filter(
        (project) => project.category === selectedCategory,
      );
    }

    projectsToFilter = projectsToFilter.filter((project) => {
      if (project.status === "pending" && !showPending) return false;
      if (project.status === "rejected" || project.status === "hidden")
        return false;
      return project.fundingGoal <= goalFilter;
    });

    switch (sortBy) {
      case "latest":
        projectsToFilter.sort(
          (a, b) =>
            new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime(),
        );
        break;
      case "popularity":
        projectsToFilter.sort((a, b) => b.currentFunding - a.currentFunding);
        break;
      case "relevance":
      default:
        projectsToFilter.sort((a, b) => a.title.localeCompare(b.title));
        break;
    }

    return projectsToFilter;
  }, [
    allProjects,
    searchQuery,
    selectedCategory,
    sortBy,
    goalFilter,
    showPending,
  ]);

  return (
    <div className="container mx-auto py-12" suppressHydrationWarning>
      <div className="flex justify-between items-start mb-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight font-headline text-accent">
            Explore Projects
          </h1>
          {searchQuery && (
            <div className="flex items-center gap-2">
              <p className="text-md text-muted-foreground">
                Showing results for:{" "}
                <span className="font-semibold text-foreground">
                  {searchQuery}
                </span>
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
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>

      <AnimatePresence>
        {isFilterVisible && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <ProjectFilters
              sortBy={sortBy}
              onSortByChange={setSortBy}
              goalFilter={goalFilter}
              onGoalFilterChange={handleGoalFilterChange} 
              maxGoal={maxGoal}
              showPending={showPending}
              onShowPendingChange={setShowPending}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="my-8">
        <CategoryFilter
          categories={sortedCategories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />
      </div>

      <FilteredProjectList
        projects={filteredProjects}
        isLoading={isLoadingProjects}
      />
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto py-12 text-center">Loading projects...</div>}>
      <ProjectsContent />
    </Suspense>
  );
}
