"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/project/ProjectCard";
import { ConsensusBadge } from "@/components/project/ConsensusBadge";
import { RestrictionNotice } from "@/components/project/RestrictionNotice";
import type { Project } from "@/lib/types";

/** "Your projects": the vaults this account opened, with any listing notice. */
export function ProjectsTab({ projects, loading }: { projects: Project[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading your projects">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">
          You haven&apos;t started a project. Builders post a deposit and get paid stage by stage as
          stakeholders approve.
        </p>
        <Button asChild>
          <Link href="/create-listing">Start a project</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <div key={p.id} className="space-y-2">
          <ProjectCard project={p} />
          {/* Rare: shown only when the listing was flagged, hidden or paused,
              so the builder reads why here rather than inferring it. */}
          <ConsensusBadge projectId={p.id} />
          <RestrictionNotice restriction={p.restriction} />
        </div>
      ))}
    </div>
  );
}
