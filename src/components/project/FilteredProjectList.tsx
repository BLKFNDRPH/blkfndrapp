"use client";

import { ProjectCard } from "./ProjectCard";
import { ProjectLoader } from "./ProjectLoader";
import type { Project } from "@/lib/types";

interface FilteredProjectListProps {
  projects: Project[];
  isLoading: boolean;
}

export function FilteredProjectList({
  projects,
  isLoading,
}: FilteredProjectListProps) {
  return (
    <div>
      {isLoading ? (
        <ProjectLoader />
      ) : projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mt-8">
          {projects.map((project) => (
            <div key={project.id} className="h-full">
              <ProjectCard project={project} />
            </div>
          ))}
        </div>
      ) : (
        <p className="col-span-full text-center text-muted-foreground mt-8">
          No projects match the current filters.
        </p>
      )}
    </div>
  );
}
