"use client";

import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import type { Project } from "@/lib/types";
import { ProjectDetailsDialog } from "@/components/project/ProjectDetailsDialog";
import { AnimatePresence } from "framer-motion";
import { getProjectById } from "@/lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { useAuth } from "@/context/AuthContext";

interface ProjectDetailsContextType {
  project: Project | null;
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  isFundFlow: boolean;
  openProjectDetails: (
    initialProject: Project,
    startFundFlow?: boolean,
  ) => void;
  closeProjectDetails: () => void;
  setIsFundFlow: (isFundFlow: boolean) => void;
  refreshProject: (projectId: string) => void;
  /**
   * Open the sign-in dialog on top of the project dialog, and bring the
   * project back once the sign-in has completed. `fund` reopens it in the
   * fund flow, for a press on the fund button.
   */
  signInToContinue: (options?: { fund?: boolean }) => void;
}

const ProjectDetailsContext = createContext<
  ProjectDetailsContextType | undefined
>(undefined);

// Signing in ends with the page being rebuilt. Google comes back through a
// full navigation, and a password sign-in redirects through Next's redirect
// boundary, which remounts the whole client tree. Either way this provider
// starts over and the open dialog is gone. So the project someone was looking
// at is noted before the sign-in dialog opens, and reopened once there is a
// signed-in user. sessionStorage is per tab and survives both round trips.
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
    // sign-in still works; the dialog just does not come back on its own.
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

export const ProjectDetailsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [project, setProject] = useState<Project | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFundFlow, setIsFundFlow] = useState(false);
  const { user, loading: authLoading, login } = useAuth();

  const fetchProject = useCallback(
    async (projectId: string, fallbackProject?: Project) => {
      setIsLoading(true);
      setError(null);
      try {
        const freshProject = await getProjectById(projectId);
        if (freshProject) {
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
          setProject(freshProject);
        } else {
          setProject((prev) =>
            prev?.id === projectId ? prev : (fallbackProject ?? prev ?? null),
          );
          if (!fallbackProject) {
            setError("Project details could not be refreshed right now.");
          }
        }
      } catch (e) {
        if (!fallbackProject) {
          setError(
            e instanceof Error ? e.message : "An unknown error occurred.",
          );
        }
        console.error("Failed to fetch project details:", e);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const openProjectDetails = useCallback(
    (initialProject: Project, startFundFlow = false) => {
      setProject(initialProject);
      setIsOpen(true);
      setError(null);
      setIsFundFlow(startFundFlow);
      fetchProject(initialProject.id, initialProject);
    },
    [fetchProject],
  );

  const closeProjectDetails = () => {
    // Closing it is also the signal that nobody wants it back after a sign-in.
    forgetProjectToResume();
    setIsOpen(false);
    setTimeout(() => {
      setProject(null);
      setIsFundFlow(false);
      setError(null);
    }, 300);
  };

  const refreshProject = useCallback(
    (projectId: string) => {
      const fallbackProject = project?.id === projectId ? project : undefined;
      fetchProject(projectId, fallbackProject);
    },
    [fetchProject, project],
  );

  const signInToContinue = (options?: { fund?: boolean }) => {
    if (project) rememberProjectToResume(project.id, options?.fund === true);
    login();
  };

  // Bring back the project noted before a sign-in, once the sign-in is done.
  // Nothing is consumed while signed out: the note has to survive the trip to
  // the provider and back, and a visit that never signs in leaves it to expire.
  const userId = user?.uid ?? null;
  useEffect(() => {
    if (authLoading || !userId) return;
    const pending = takeProjectToResume();
    if (!pending) return;

    if (isOpen && project?.id === pending.id) {
      // Still open, so the sign-in happened without a remount (the dialog was
      // dismissed and the sign-in came from the header, say).
      if (pending.fund) setIsFundFlow(true);
      return;
    }

    let cancelled = false;
    getProjectById(pending.id).then((found) => {
      if (!cancelled && found) openProjectDetails(found, pending.fund);
    });
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId, isOpen, project?.id, openProjectDetails]);

  return (
    <ProjectDetailsContext.Provider
      value={{
        project,
        isOpen,
        isLoading,
        error,
        openProjectDetails,
        closeProjectDetails,
        isFundFlow,
        setIsFundFlow,
        refreshProject,
        signInToContinue,
      }}
    >
      {children}
      <AnimatePresence>{isOpen && <ProjectDetailsDialog />}</AnimatePresence>
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
