"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { useAuth } from "@/context/AuthContext";
import {
  legacyProjectParam,
  projectHref,
  PROJECTS_PATH,
  type ProjectTab,
} from "@/lib/project-href";

/**
 * The project someone is looking at, with its live vault figures.
 *
 * A project is a page at /projects/[id]. This provider sits in the root layout
 * so that the page, the stake sheet inside it and the places that link to a
 * project (cards, search, notifications, the admin console) share one copy of
 * the project and one fund-flow flag. `openProjectDetails` keeps its name from
 * the days when projects opened in a dialog; it now navigates to the page.
 */
interface ProjectDetailsContextType {
  project: Project | null;
  isLoading: boolean;
  error: string | null;
  /** The id asked for does not exist, as far as the listing can tell. */
  notFound: boolean;
  isFundFlow: boolean;
  /**
   * Go to the project's page, with what is already known about it in hand.
   * `tab` lands on that tab (the admin console's proof review opens Stages).
   */
  openProjectDetails: (
    initialProject: Project,
    startFundFlow?: boolean,
    options?: { tab?: ProjectTab },
  ) => void;
  /**
   * Load a project into the provider without navigating: the project page
   * calls this on arrival. `fallback` stands in until the live read lands.
   */
  loadProject: (projectId: string, fallback?: Project) => void;
  /** Forget the loaded project. Clears state only; the URL is left alone. */
  closeProjectDetails: () => void;
  setIsFundFlow: (isFundFlow: boolean) => void;
  refreshProject: (projectId: string) => void;
  /**
   * Open the sign-in dialog over the project page, and bring the project back
   * once the sign-in has completed. `fund` reopens it in the fund flow, for a
   * press on the stake button.
   */
  signInToContinue: (options?: { fund?: boolean }) => void;
}

const ProjectDetailsContext = createContext<
  ProjectDetailsContextType | undefined
>(undefined);

// Signing in ends with the page being rebuilt. Google comes back through a
// full navigation, and a password sign-in redirects through Next's redirect
// boundary, which remounts the whole client tree. Either way this provider
// starts over. The sign-in form's "next" field carries the person back to the
// project's page on its own; what it cannot carry is the intent, so the
// project and whether they were about to stake are noted before the sign-in
// dialog opens and read back once there is a signed-in user. sessionStorage
// is per tab and survives both round trips.
const RESUME_KEY = "blkfndr.resume-project";
// The lifetime of the post-sign-in destination cookie, so an abandoned attempt
// does not reopen a project much later.
const RESUME_MAX_AGE_MS = 10 * 60 * 1000;

type ResumeProject = { id: string; fund: boolean };

function rememberProjectToResume(id: string, fund: boolean) {
  try {
    sessionStorage.setItem(
      RESUME_KEY,
      JSON.stringify({ id, fund, at: Date.now() }),
    );
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The
    // sign-in still works; the stake sheet just does not reopen on its own.
  }
}

function forgetProjectToResume() {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {}
}

function takeProjectToResume(): ResumeProject | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RESUME_KEY);
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id !== "string" || typeof parsed?.at !== "number") {
      return null;
    }
    if (Date.now() - parsed.at > RESUME_MAX_AGE_MS) return null;
    return { id: parsed.id, fund: parsed.fund === true };
  } catch {
    return null;
  }
}

/**
 * The listing as the API serves it, telling a missing project from a failed
 * read. data.client's getProjectById folds both into `undefined`, which the
 * page cannot turn into the right sentence.
 */
type ProjectRead =
  | { kind: "ok"; project: Project }
  | { kind: "missing" }
  | { kind: "error"; message: string };

async function readProject(projectId: string): Promise<ProjectRead> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    if (res.ok) return { kind: "ok", project: (await res.json()) as Project };
    if (res.status === 404) return { kind: "missing" };
    return { kind: "error", message: `The listing answered ${res.status}.` };
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : "An unknown error occurred.",
    };
  }
}

export const ProjectDetailsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isFundFlow, setIsFundFlow] = useState(false);
  const { user, loading: authLoading, login } = useAuth();
  const router = useRouter();

  // The project the page currently shows, or has asked for. A ref, so the
  // effects below can read it in the same pass the page's own effect set it
  // (children's effects run first), and so loadProject stays stable.
  const projectRef = useRef<Project | null>(null);
  const requestedIdRef = useRef<string | null>(null);
  // Each load gets a number; a read that lands after a newer load began, or
  // after the page was left, is dropped rather than shown for the wrong page.
  const loadSeq = useRef(0);

  const fetchProject = useCallback(
    async (projectId: string, fallbackProject?: Project) => {
      const seq = ++loadSeq.current;
      const current = () => seq === loadSeq.current;
      setIsLoading(true);
      setError(null);
      try {
        const read = await readProject(projectId);
        if (!current()) return;
        if (read.kind === "ok") {
          const freshProject = read.project;
          if (freshProject.vaultAddress) {
            try {
              const vaultClient = new VaultClient({
                contractId: freshProject.vaultAddress,
                rpcUrl: SOROBAN_RPC_URL,
                networkPassphrase: NETWORK_PASSPHRASE,
              });

              let liveState: number | undefined;
              try {
                const stateTx = await vaultClient.get_state();
                const stateRes = await stateTx.simulate();
                liveState = stateRes.result;
              } catch (stateErr) {
                console.warn("Failed to fetch live on-chain state:", stateErr);
              }

              let info: any;
              try {
                const infoTx = await vaultClient.get_info();
                const infoRes = await infoTx.simulate();
                info = infoRes.result;
              } catch (infoErr) {
                console.warn("Failed to fetch live on-chain info:", infoErr);
              }

              if (liveState !== undefined) {
                const statusMap: Record<number, Project["status"]> = {
                  0: "raising",
                  1: "funded",
                  2: "active",
                  3: "failed",
                  4: "refunding",
                  5: "completed",
                };

                let mappedStatus = statusMap[liveState] || freshProject.status;

                if (info) {
                  freshProject.currentFunding = Number(info.raised_amount) / 10_000_000;
                  freshProject.fundingGoal = Number(info.goal) / 10_000_000;
                  freshProject.currentFundingRaw = info.raised_amount.toString();
                  freshProject.fundingGoalRaw = info.goal.toString();
                  freshProject.fundingDeadline = Number(info.deadline) * 1000;
                  freshProject.bondPosted = info.bond_posted;
                  freshProject.bondAmount = Number(info.bond_amount) / 10_000_000;
                  freshProject.releasedTotal = Number(info.released_total) / 10_000_000;

                  if (mappedStatus === "raising" && !info.bond_posted) {
                    mappedStatus = "pending";
                  }

                  if (info.milestones && info.milestones.length > 0) {
                    freshProject.milestones = (freshProject.milestones || []).map((m) => {
                      const liveM = info.milestones.find((lm: any) => Number(lm.id) === m.id);
                      return {
                        ...m,
                        released: liveM ? liveM.released : m.released,
                        amount: liveM ? Number(liveM.amount) / 10_000_000 : m.amount,
                      };
                    });
                  }
                }

                freshProject.status = mappedStatus;

                // Persisting is the indexer's job.
              }
            } catch (chainErr) {
              console.warn("Failed to fetch live on-chain project vault data, falling back to db cache:", chainErr);
            }
          }
          if (!current()) return;
          projectRef.current = freshProject;
          setProject(freshProject);
          setNotFound(false);
        } else if (read.kind === "missing") {
          // Keep whatever was already in hand for this id (a card's copy, or
          // the last good read) rather than blank the page.
          const kept =
            projectRef.current?.id === projectId
              ? projectRef.current
              : (fallbackProject ?? null);
          projectRef.current = kept;
          setProject(kept);
          if (!kept) setNotFound(true);
        } else {
          const kept =
            projectRef.current?.id === projectId
              ? projectRef.current
              : (fallbackProject ?? null);
          projectRef.current = kept;
          setProject(kept);
          setError(read.message);
          console.error("Failed to fetch project details:", read.message);
        }
      } finally {
        if (current()) setIsLoading(false);
      }
    },
    [],
  );

  const loadProject = useCallback(
    (projectId: string, fallback?: Project) => {
      const known =
        fallback ??
        (projectRef.current?.id === projectId ? projectRef.current : undefined);
      requestedIdRef.current = projectId;
      projectRef.current = known ?? null;
      setProject(known ?? null);
      setNotFound(false);
      setError(null);
      fetchProject(projectId, known);
    },
    [fetchProject],
  );

  const openProjectDetails = useCallback(
    (initialProject: Project, startFundFlow = false, options?: { tab?: ProjectTab }) => {
      // The page reads this copy straight away and refreshes it from the
      // vault; the stake intent travels in the address so a link can carry it.
      projectRef.current = initialProject;
      setProject(initialProject);
      setError(null);
      setNotFound(false);
      setIsFundFlow(startFundFlow);
      router.push(
        projectHref(initialProject.id, { stake: startFundFlow, tab: options?.tab }),
      );
    },
    [router],
  );

  const closeProjectDetails = useCallback(() => {
    // Leaving the page is also the signal that nobody wants it back after a
    // sign-in. But a password sign-in rebuilds the client tree at the same
    // address, which unmounts the page without anyone leaving it, and the
    // note has to survive that trip: it is kept while the address still names
    // this project. A read still in flight is dropped either way.
    const id = requestedIdRef.current;
    const stillHere =
      id !== null &&
      typeof window !== "undefined" &&
      window.location.pathname === projectHref(id);
    if (!stillHere) forgetProjectToResume();
    loadSeq.current++;
    requestedIdRef.current = null;
    projectRef.current = null;
    setProject(null);
    setIsFundFlow(false);
    setError(null);
    setNotFound(false);
    setIsLoading(false);
  }, []);

  const refreshProject = useCallback(
    (projectId: string) => {
      const fallbackProject =
        projectRef.current?.id === projectId ? projectRef.current : undefined;
      fetchProject(projectId, fallbackProject);
    },
    [fetchProject],
  );

  const signInToContinue = useCallback(
    (options?: { fund?: boolean }) => {
      const id = requestedIdRef.current ?? projectRef.current?.id ?? null;
      if (id) rememberProjectToResume(id, options?.fund === true);
      login();
    },
    [login],
  );

  // A link from before projects had pages: "?project=<id>" on whichever page
  // the dialog was opened from ("/projects?project=4", but also "/?project=4"
  // from a home-page card). Send it to the page it meant, once, on arrival.
  // Read with the plain location API: this provider sits in the root layout,
  // where useSearchParams would need a Suspense boundary around the whole app.
  const legacyLinkHandled = useRef(false);
  useEffect(() => {
    if (legacyLinkHandled.current) return;
    legacyLinkHandled.current = true;
    if (window.location.pathname.startsWith(`${PROJECTS_PATH}/`)) return;
    const id = legacyProjectParam(window.location.search);
    if (id) router.replace(projectHref(id));
  }, [router]);

  // Finish what was started before a sign-in, once the sign-in is done.
  // Nothing is consumed while signed out: the note has to survive the trip to
  // the provider and back, and a visit that never signs in leaves it to expire.
  const userId = user?.uid ?? null;
  useEffect(() => {
    if (authLoading || !userId) return;
    const pending = takeProjectToResume();
    if (!pending) return;

    const onPage = requestedIdRef.current;
    if (onPage === pending.id) {
      // The "next" field already brought the page back (or it never left:
      // the sign-in came from the header, say). Only the intent is left.
      if (pending.fund) setIsFundFlow(true);
      return;
    }
    if (onPage === null) {
      // The sign-in finished somewhere else; take them to the project.
      router.push(projectHref(pending.id, { stake: pending.fund }));
    }
    // On a different project's page: they moved on, so the note is dropped.
  }, [authLoading, userId, router]);

  return (
    <ProjectDetailsContext.Provider
      value={{
        project,
        isLoading,
        error,
        notFound,
        openProjectDetails,
        loadProject,
        closeProjectDetails,
        isFundFlow,
        setIsFundFlow,
        refreshProject,
        signInToContinue,
      }}
    >
      {children}
    </ProjectDetailsContext.Provider>
  );
};

export const useProjectDetails = () => {
  const context = useContext(ProjectDetailsContext);
  if (context === undefined) {
    throw new Error(
      "useProjectDetails must be used within a ProjectDetailsProvider",
    );
  }
  return context;
};
