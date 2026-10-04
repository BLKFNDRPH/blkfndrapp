"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CubeSpinner } from "@/components/ui/CubeSpinner";
import { ProjectView } from "@/components/project/ProjectView";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { useAuth } from "@/context/AuthContext";
import { PROJECTS_PATH, type ProjectTab } from "@/lib/project-href";

const TAB_VALUES: ReadonlySet<string> = new Set<ProjectTab>([
  "overview",
  "stages",
  "record",
  "builder",
]);

function readTab(value: string | null): ProjectTab {
  return value && TAB_VALUES.has(value) ? (value as ProjectTab) : "overview";
}

/**
 * Change this page's query string in place. The native history API rather
 * than router.replace: Next folds pushState/replaceState into its router, so
 * useSearchParams still updates, but without the server round trip a
 * router.replace makes for a page whose props never change. A tab switch is
 * instant and nothing is added to the history stack.
 */
function rewriteQuery(change: (params: URLSearchParams) => void) {
  const url = new URL(window.location.href);
  change(url.searchParams);
  window.history.replaceState(window.history.state, "", url.toString());
}

function BackToProjects() {
  return (
    <Link
      href={PROJECTS_PATH}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Projects
    </Link>
  );
}

/** The page's shape before the vault has been read: title bar, money, tabs. */
function ProjectSkeleton() {
  return (
    <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8" role="status" aria-live="polite">
      <BackToProjects />
      <div className="mt-3 space-y-3 border-b pb-4">
        <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
        <div className="flex gap-2">
          <div className="h-5 w-24 rounded-full bg-muted animate-pulse" />
          <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-7 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
        <div className="h-2 w-full rounded bg-muted animate-pulse" />
      </div>
      <div className="mt-4 h-10 w-72 max-w-full rounded-md bg-muted animate-pulse" />
      <div className="mt-8 flex flex-col items-center gap-3">
        <CubeSpinner size="large" />
        <p className="text-sm text-muted-foreground">Reading the vault…</p>
      </div>
    </div>
  );
}

function ProjectPageInner({ id }: { id: string }) {
  const {
    project,
    isLoading,
    error,
    notFound,
    loadProject,
    closeProjectDetails,
    refreshProject,
    setIsFundFlow,
    signInToContinue,
  } = useProjectDetails();
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  // Ask the provider for this id on arrival; forget it on the way out. Moving
  // from one project's page to another's runs the cleanup and the load again.
  useEffect(() => {
    loadProject(id);
    return () => closeProjectDetails();
  }, [id, loadProject, closeProjectDetails]);

  // ?stake=1 means "stake in this project": open the stake sheet, or, signed
  // out, the sign-in sheet with that intent noted so it opens on return. The
  // flag is consumed once auth has settled and then dropped from the address,
  // so a refresh or the back button does not ask again.
  // useSearchParams does not follow a replaceState write, so the flag is
  // consumed exactly once per page visit, by a ref, rather than re-read.
  const stakeParam = searchParams.get("stake");
  const stakeConsumed = useRef(false);
  useEffect(() => {
    if (stakeParam !== "1" || authLoading || stakeConsumed.current) return;
    stakeConsumed.current = true;
    rewriteQuery((params) => params.delete("stake"));
    if (user) setIsFundFlow(true);
    else signInToContinue({ fund: true });
  }, [stakeParam, authLoading, user, setIsFundFlow, signInToContinue]);

  // The active tab lives in the address, so a tab can be linked to. It is
  // held in state because a replaceState write does not reach
  // useSearchParams; the param seeds the state on arrival and whenever Next
  // itself navigates to a different ?tab= (a link from the builder card, say).
  const paramTab = readTab(searchParams.get("tab"));
  const [tab, setTabState] = useState<ProjectTab>(paramTab);
  useEffect(() => {
    setTabState(paramTab);
  }, [paramTab]);
  const setTab = (next: ProjectTab) => {
    setTabState(next);
    rewriteQuery((params) => {
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
    });
  };

  if (!project) {
    if (notFound) {
      return (
        <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <BackToProjects />
          <div className="mt-16 flex flex-col items-center gap-3 text-center">
            <h1 className="text-xl font-semibold">We can&apos;t find that project.</h1>
            <Button asChild variant="outline">
              <Link href={PROJECTS_PATH}>Back to projects</Link>
            </Button>
          </div>
        </div>
      );
    }
    if (error && !isLoading) {
      return (
        <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <BackToProjects />
          <div className="mt-16 flex flex-col items-center gap-4 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive" aria-hidden="true" />
            <h1 className="text-xl font-semibold">
              We couldn&apos;t read this vault&apos;s live figures.
            </h1>
            <Button type="button" variant="outline" onClick={() => refreshProject(id)}>
              <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return <ProjectSkeleton />;
  }

  return <ProjectView tab={tab} onTabChange={setTab} />;
}

/**
 * The client half of /projects/[id]. useSearchParams needs a Suspense
 * boundary; the skeleton it falls back to is the same one the loading state
 * shows, so nothing flashes between the two.
 */
export function ProjectPageClient({ id }: { id: string }) {
  return (
    <Suspense fallback={<ProjectSkeleton />}>
      <ProjectPageInner id={id} />
    </Suspense>
  );
}
