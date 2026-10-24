/**
 * A project's live vault figures, as the browser gets them: from this app's
 * own /api/projects/[id]/live, which reads the vault on the server and shares
 * the answer for a few seconds, instead of from the public RPC directly.
 *
 * Self-contained so node --test can load it.
 */

import type { Project } from "./types.ts";
import type { VaultState } from "./vault-state.ts";

/**
 * The vault's figures for a project, or null when it has none or could not be
 * read. `fresh` asks the server to read again rather than serve its cache,
 * which it honours only for a signed-in caller: use it after their own action.
 */
export async function fetchVaultState(
  projectId: string,
  options: { fresh?: boolean } = {},
): Promise<VaultState | null> {
  try {
    const query = options.fresh ? "?fresh=1" : "";
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/live${query}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as VaultState;
  } catch (error) {
    console.warn(`Failed to read the vault of project ${projectId}:`, error);
    return null;
  }
}

/**
 * The project with the ledger's word on its state, money and stages laid over
 * the indexed copy. Titles and deliverables stay the listing's; a stage only
 * takes the vault's amount and released flag.
 */
export function withVaultState(project: Project, state: VaultState): Project {
  return {
    ...project,
    status: state.status as Project["status"],
    currentFunding: state.currentFunding,
    currentFundingRaw: state.currentFundingRaw,
    fundingGoal: state.fundingGoal,
    fundingGoalRaw: state.fundingGoalRaw,
    fundingDeadline: state.fundingDeadline,
    bondPosted: state.bondPosted,
    bondAmount: state.bondAmount,
    bondReturned: state.bondReturned,
    releasedTotal: state.releasedTotal,
    milestones:
      state.milestones.length > 0
        ? (project.milestones ?? []).map((m) => {
            const live = state.milestones.find((lm) => lm.id === m.id);
            return live ? { ...m, released: live.released, amount: live.amount } : m;
          })
        : project.milestones,
  };
}
