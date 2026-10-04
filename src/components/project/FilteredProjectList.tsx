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
      {projects.map((project) => (
        <div key={project.id} className="h-full">
          <ProjectCard project={project} />
        </div>
      ))}
    </div>
  );
}
