"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Skeleton cards shown while a project grid loads.
 *
 * Replaces the landing spaceship. A skeleton promises exactly what is coming
 * (a grid of cards) and takes the space the cards will take, so the page does
 * not jump when they arrive. It is never a full-screen overlay: the rest of the
 * page stays readable and usable while the vaults are read.
 */

interface ProjectLoaderProps {
  /** How many placeholder cards to show. Defaults to one row per column count. */
  count?: number;
  className?: string;
}

function Bone({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted animate-pulse motion-reduce:animate-none",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export function ProjectCardSkeleton() {
  return (
    <Card
      className="flex h-full w-full flex-col gap-2 overflow-hidden"
      aria-hidden="true"
    >
      <Bone className="h-40 w-full rounded-none" />
      <div className="flex flex-grow flex-col gap-2 p-4 pt-2">
        <Bone className="h-5 w-3/4" />
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-5/6" />
        <div className="mt-auto space-y-2 pt-3">
          <Bone className="h-4 w-2/3" />
          <Bone className="h-1.5 w-full rounded-full" />
        </div>
      </div>
      <div className="flex items-center gap-2 p-4 pt-0">
        <Bone className="h-7 w-7 rounded-full" />
        <Bone className="h-4 w-24" />
      </div>
    </Card>
  );
}

export function ProjectLoader({ count = 6, className }: ProjectLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      <span className="sr-only">Loading projects</span>
      {Array.from({ length: count }, (_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}
