"use client";

import type { Project } from "@/lib/types";
import { ProjectCard } from "./ProjectCard";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import React from "react";

interface ProjectListProps {
  projects: Project[];
  showStatus?: boolean;
  onlyShowCompletedStatus?: boolean;
}

export function ProjectList({
  projects,
  showStatus = true,
  onlyShowCompletedStatus = false,
}: ProjectListProps) {
  const plugin = React.useRef(
    Autoplay({ delay: 4000, stopOnInteraction: true }),
  );

  if (projects.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        No projects found.
      </div>
    );
  }

  return (
    <Carousel
      plugins={[plugin.current]}
      opts={{
        align: "start",
        loop: true,
      }}
      onMouseEnter={plugin.current.stop}
      onMouseLeave={plugin.current.reset}
      className="w-full"
    >
      <CarouselContent className="-ml-6">
        {projects.map((project) => (
          <CarouselItem
            key={project.id}
            className="md:basis-1/2 lg:basis-1/3 pl-6"
          >
            <div className="p-6 h-full">
              <ProjectCard
                project={project}
                showStatus={showStatus}
                onlyShowCompletedStatus={onlyShowCompletedStatus}
              />
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}
