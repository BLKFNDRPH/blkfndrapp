"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Project } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import { cn } from "@/lib/utils";
import { getIPFSGatewayUrl } from "@/lib/pinata-client";
import "./ProjectCard.css";
import { ImageWithFallback } from "../ui/image-with-fallback";
import {
  describeDeadline,
  describeStatus,
  secondaryBadges,
  TONE_CLASSES,
  type StatusView,
} from "@/lib/project-status";
import { describeProgress } from "@/lib/money";
import { useXlmRate } from "@/lib/xlm-rate";

/**
 * One project, compared at a glance, in dollars.
 *
 * Every word on the card is a word the vault's rules give a plain meaning to:
 * the status pill says what a visitor can do right now, the money row says how
 * far the vault is from its goal and how long it stays open, and the footer
 * names the builder. Nothing on the card is a public key, a token icon or a
 * bare percentage.
 */

interface ProjectCardProps {
  project: Project;
  /** Hide the status pill altogether. */
  showStatus?: boolean;
}

/** A Stellar account or contract id, which must never be shown as a name. */
const LOOKS_LIKE_ADDRESS = /^[GC][A-Z2-7]{55}$/;

/** The display name for a card footer: the linked profile's name, or "Builder". */
export function builderDisplayName(project: Pick<Project, "creatorName" | "creator" | "creatorAddress" | "creatorId">): string {
  const name = project.creatorName?.trim();
  if (!name) return "Builder";
  const address = project.creatorAddress ?? project.creatorId ?? project.creator;
  if (name === address || LOOKS_LIKE_ADDRESS.test(name)) return "Builder";
  return name;
}

/** The status pill with its tooltip sentence. Needs a TooltipProvider above it. */
export function StatusPill({
  status,
  className,
}: {
  status: StatusView;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-status={status.key}
          className={cn(
            "inline-flex cursor-default items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            TONE_CLASSES[status.tone],
            className,
          )}
        >
          {status.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {status.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function resolveImageSrc(src?: string | null): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("blob:")) {
    return src;
  }
  if (src.startsWith("ipfs://")) {
    return getIPFSGatewayUrl(src.replace(/^ipfs:\/\//, ""));
  }
  if (src.includes("/ipfs/") || src.includes("://")) return src;
  const cid = src.split("/").pop();
  return cid ? getIPFSGatewayUrl(cid) : src;
}

function progressPercent(project: Project): number {
  if (project.status === "completed" || project.status === "funded") return 100;
  const raised =
    project.currentFundingRaw !== undefined
      ? parseInt(project.currentFundingRaw, 10)
      : project.currentFunding;
  const goal =
    project.fundingGoalRaw !== undefined
      ? parseInt(project.fundingGoalRaw, 10)
      : project.fundingGoal;
  if (!Number.isFinite(raised) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.min((raised / goal) * 100, 100));
}

export function ProjectCard({ project, showStatus = true }: ProjectCardProps) {
  const { openProjectDetails } = useProjectDetails();
  const { rate, isLoading: rateLoading } = useXlmRate();

  const status = describeStatus(project);
  const badges = secondaryBadges(project);
  const money = describeProgress(
    project.currentFunding,
    project.fundingGoal,
    project.currencyType,
    rate,
  );
  // Days left only matter while a visitor can still stake; every other state
  // already says in its pill what happened to the deadline.
  const deadline =
    status.key === "open" ? describeDeadline(project.fundingDeadline) : null;
  const isXlm = (project.currencyType || "USDC").toUpperCase() === "XLM";
  const rateUnavailable = isXlm && !rateLoading && !rate;

  const imageSrc = resolveImageSrc(project.imageUrl);
  const creatorName = builderDisplayName(project);
  const percent = progressPercent(project);

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="project-card-wrapper"
        onClick={() => openProjectDetails(project)}
      >
        <Card className="project-card flex h-full w-full cursor-pointer flex-col gap-2 overflow-hidden transition-transform hover:shadow-xl">
          <CardHeader className="relative w-full shrink-0 p-0">
            {showStatus && (
              <div className="absolute left-3 top-3 z-10 rounded-full bg-background/85 backdrop-blur-sm">
                <StatusPill status={status} />
              </div>
            )}
            {badges.length > 0 && (
              <div className="absolute right-3 top-3 z-10 flex gap-1.5">
                {badges.map((badge) => (
                  <Tooltip key={badge.key}>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="inline-flex cursor-default items-center rounded-full border border-border bg-background/85 px-2 py-0.5 text-xs font-semibold leading-5 text-foreground backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {badge.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs leading-relaxed">
                      {badge.tooltip}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
            <div className="relative h-40 w-full">
              <ImageWithFallback
                src={imageSrc || ""}
                alt={project.title}
                className="h-full w-full object-cover"
                fill
              />
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 w-full flex-grow flex-col justify-start gap-2 overflow-hidden p-4 pt-2">
            <div className="min-w-0 w-full">
              <CardTitle className="mb-1 line-clamp-2 w-full break-words font-headline text-lg font-bold leading-tight">
                {project.title}
              </CardTitle>
              <CardDescription className="project-tagline line-clamp-2 w-full text-sm">
                {project.tagline}
              </CardDescription>
            </div>

            <div className="mt-auto space-y-1.5 pt-1">
              <p className="text-sm font-medium text-foreground">
                {rateUnavailable ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
                        {money.line}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Live rate unavailable</TooltipContent>
                  </Tooltip>
                ) : (
                  <span>{money.line}</span>
                )}
                {deadline && !deadline.passed && (
                  <span className="text-muted-foreground"> · {deadline.label}</span>
                )}
              </p>
              <Progress
                value={percent}
                className="h-1.5"
                aria-label={money.line}
              />
            </div>
          </CardContent>

          <CardFooter className="flex w-full shrink-0 items-center gap-2 p-4 pt-0">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={project.creatorAvatar} alt="" />
              <AvatarFallback className="text-xs">
                {creatorName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span
              className="min-w-0 truncate text-sm font-medium text-foreground"
              title={creatorName}
            >
              {creatorName}
            </span>
          </CardFooter>
        </Card>
      </div>
    </TooltipProvider>
  );
}
