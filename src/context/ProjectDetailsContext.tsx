"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
} from "react";
import type { Project } from "@/lib/types";
import { ProjectDetailsDialog } from "@/components/project/ProjectDetailsDialog";
import { AnimatePresence } from "framer-motion";
import { getProjectById } from "@/lib/data.client";
import { Client as VaultClient } from "@/packages/blkfndr_vault/src";
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE } from "@/lib/stellar";
import { updateProjectStatusFromChain } from "@/app/actions";

interface ProjectDetailsContextType {
  project: Project | null;
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  isFundFlow: boolean;
  isEditMode: boolean;
  isSaveDisabled: boolean;
  isSaving: boolean;
  openProjectDetails: (
    initialProject: Project,
    startFundFlow?: boolean,
  ) => void;
  closeProjectDetails: () => void;
  setIsFundFlow: (isFundFlow: boolean) => void;
  setIsEditMode: (isEditMode: boolean) => void;
  refreshProject: (projectId: string) => void;
  setIsSaveDisabled: (disabled: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
}

const ProjectDetailsContext = createContext<
  ProjectDetailsContextType | undefined
>(undefined);

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
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaveDisabled, setIsSaveDisabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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

                updateProjectStatusFromChain(freshProject.vaultAddress!).catch((err) =>
                  console.warn("Failed to persist on-chain status to DB:", err)
                );
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

  const openProjectDetails = (
    initialProject: Project,
    startFundFlow = false,
  ) => {
    setProject(initialProject);
    setIsOpen(true);
    setError(null);
    setIsFundFlow(startFundFlow);
    setIsEditMode(false);
    setIsSaveDisabled(true);
    setIsSaving(false);
    fetchProject(initialProject.id, initialProject);
  };

  const closeProjectDetails = () => {
    setIsOpen(false);
    setTimeout(() => {
      setProject(null);
      setIsFundFlow(false);
      setIsEditMode(false);
      setError(null);
      setIsSaving(false);
    }, 300);
  };

  const refreshProject = useCallback(
    (projectId: string) => {
      const fallbackProject = project?.id === projectId ? project : undefined;
      fetchProject(projectId, fallbackProject);
    },
    [fetchProject, project],
  );

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
        isEditMode,
        setIsEditMode,
        refreshProject,
        isSaveDisabled,
        setIsSaveDisabled,
        isSaving,
        setIsSaving,
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
