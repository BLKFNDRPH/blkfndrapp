"use client";

import { ProjectCard } from "./ProjectCard";
import { ProjectLoader } from "./ProjectLoader";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/types";

interface FilteredProjectListProps {
  projects: Project[];
  isLoading: boolean;
  /** Resets every filter on the page. Shown on the empty state. */
  onClearFilters?: () => void;
}

export function FilteredProjectList({
  projects,
  isLoading,
  onClearFilters,
}: FilteredProjectListProps) {
  if (isLoading) {
    return <ProjectLoader className="mt-8" />;
  }

  if (projects.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
        <p className="text-muted-foreground">Nothing matches these filters.</p>
        {onClearFilters && (
          <Button variant="outline" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project, index) => (
        <div key={project.id} className="h-full">
          {/* The first card's picture is usually the largest paint, on a phone
              and on a wide screen alike: it alone is fetched first. The rest
              of a wide screen's first row loads at once but at the browser's
              own priority. When all three were high priority, React preloaded
              them from the <head>, and on a slow phone connection the two that
              are off screen took bandwidth from the stylesheets, which moved
              the first paint by up to half a second. */}
          <ProjectCard project={project} priority={index === 0} eager={index < 3} />
        </div>
      ))}
    </div>
  );
}
