"use client";

import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/types";
import { StakeSheet } from "./stake/StakeSheet";

/**
 * The stake button and, once pressed, the stake sheet in its place.
 *
 * The button opens the sheet for everyone, signed in or not: the sheet holds
 * every gate (sign in, wallet, funds) as a card, so a person can read exactly
 * what staking involves before being asked for anything. The project page
 * decides where this sits (a bar on phones, the side card on desktop) and
 * owns isFundFlow, so a ?stake=1 link and the sign-in return can open it.
 */
export function FundDialog({
  project,
  isFundFlow,
  setIsFundFlow,
}: {
  project: Project;
  isFundFlow: boolean;
  setIsFundFlow: (isFundFlow: boolean) => void;
}) {
  if (isFundFlow) {
    return (
      <div className="w-full">
        <StakeSheet project={project} onClose={() => setIsFundFlow(false)} />
      </div>
    );
  }

  const goalReached =
    Number(project.currentFundingRaw ?? 0) >= Number(project.fundingGoalRaw ?? 0) &&
    Number(project.fundingGoalRaw ?? 0) > 0;
  const deadlinePassed = project.fundingDeadline ? Date.now() > project.fundingDeadline : false;
  const isLocked = project.restriction?.locked === true;
  const isPending = project.status === "pending";
  const isClosed =
    project.status === "completed" ||
    project.status === "funded" ||
    project.status === "expired" ||
    goalReached ||
    deadlinePassed;

  const label =
    project.status === "completed"
      ? "Completed"
      : project.status === "funded" || goalReached
        ? "Goal reached"
        : deadlinePassed || project.status === "expired"
          ? "Deadline passed"
          : isLocked
            ? "Paused by BLKFNDR"
            : isPending
              ? "Awaiting builder's deposit"
              : "Stake from $5";

  return (
    <div className="w-full sm:w-auto">
      <Button
        type="button"
        onClick={() => setIsFundFlow(true)}
        variant={isClosed ? "outline" : "default"}
        disabled={isClosed || isLocked || isPending}
        className="w-full shrink-0 whitespace-nowrap sm:w-auto"
      >
        {label}
      </Button>
    </div>
  );
}
