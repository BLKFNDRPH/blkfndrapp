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
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/types";
import { formatCurrency } from "@/lib/formatters";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { useProjectDetails } from "@/context/ProjectDetailsContext";
import {
  Heart,
  Check,
  AlertTriangle,
  Star,
  TrendingUp,
  Info,
  Lock,
  Clock,
} from "lucide-react";
import { cn, shortenAddress } from "@/lib/utils";
import { getIPFSGatewayUrl } from "@/lib/pinata-client";
import "./ProjectCard.css";
import { Separator } from "../ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { ImageWithFallback } from "../ui/image-with-fallback";
import { StellarFormatter } from "@/lib/stellar-format";

interface ProjectCardProps {
  project: Project;
  showStatus?: boolean;
  onlyShowCompletedStatus?: boolean;
}

const StatusBadge = ({ status }: { status: Project["status"] }) => {
  const statusInfo = {
    featured: {
      icon: <Heart className="h-full w-full fill-red-500 text-red-500" />,
      label: "Featured",
      className: "bg-red-100 text-red-600 border-red-200",
    },
    approved: {
      icon: (
        <div className="relative h-full w-full">
          <Star className="h-full w-full fill-green-500 text-green-500" />
          <Check className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 text-white" />
        </div>
      ),
      label: "Approved",
      className: "bg-green-100 text-green-600 border-green-200",
    },
    raising: {
      icon: <TrendingUp className="h-full w-full text-amber-500" />,
      label: "Raising",
      className: "bg-amber-100 text-amber-700 border-amber-200",
    },
    active: {
      icon: <TrendingUp className="h-full w-full text-emerald-500" />,
      label: "Active",
      className: "bg-emerald-100 text-emerald-600 border-emerald-200",
    },
    pending: {
      icon: <AlertTriangle className="h-full w-full text-gray-500" />,
      label: "Pending Approval",
      className: "bg-gray-100 text-gray-600 border-gray-200",
    },
    funded: {
      icon: (
        <div className="relative h-full w-full">
          <Star className="h-full w-full fill-yellow-500 text-yellow-500" />
        </div>
      ),
      label: "Funded",
      className: "bg-yellow-100 text-yellow-600 border-yellow-200",
    },
    hidden: {
      icon: <Lock className="h-full w-full text-neutral-500" />,
      label: "Private",
      className: "bg-neutral-100 text-neutral-600 border-neutral-200",
    },
    // FIX: Added missing 'expired' status — shown when a project's deadline
    // passed without reaching its funding goal. Investors can now claim refunds.
    expired: {
      icon: <Clock className="h-full w-full text-orange-500" />,
      label: "Expired",
      className: "bg-orange-100 text-orange-600 border-orange-200",
    },
    rejected: null, // Don't show rejected badge on cards
    completed: {
      icon: <Check className="h-full w-full text-green-500" />,
      label: "Completed",
      className: "bg-green-100 text-green-600 border-green-200",
    },
    failed: {
      icon: <AlertTriangle className="h-full w-full text-red-500" />,
      label: "Failed",
      className: "bg-red-100 text-red-600 border-red-200",
    },
    refunding: {
      icon: <AlertTriangle className="h-full w-full text-orange-500" />,
      label: "Refunding",
      className: "bg-orange-100 text-orange-600 border-orange-200",
    },
  }[status];

  if (!statusInfo) return null;

  return (
    <div
      className={cn(
        "absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold",
        statusInfo.className,
      )}
    >
      <div className="h-3 w-3">{statusInfo.icon}</div>
      <span>{statusInfo.label}</span>
    </div>
  );
};

export function ProjectCard({
  project,
  showStatus = true,
  onlyShowCompletedStatus = false,
}: ProjectCardProps) {
  const { openProjectDetails } = useProjectDetails();
  const fundingPercentage =
    project.status === "completed" || project.status === "funded"
      ? 100 // show full bar for funded and completed projects
      : StellarFormatter.getPercentage(
          project.currentFundingRaw,
          project.fundingGoalRaw,
        );

  const resolveImageSrc = (src?: string | null) => {
    if (!src) return undefined;
    // already a usable URL or data/blob
    if (
      src.startsWith("http") ||
      src.startsWith("data:") ||
      src.startsWith("blob:")
    )
      return src;
    // ipfs://CID
    if (src.startsWith("ipfs://")) {
      const cid = src.replace(/^ipfs:\/\//, "");
      return getIPFSGatewayUrl(cid);
    }
    // If it's a gateway URL or contains /ipfs/, return as-is
    if (src.includes("/ipfs/") || src.includes("://")) return src;
    // treat as bare CID
    const cid = src.split("/").pop();
    if (!cid) return src;
    return getIPFSGatewayUrl(cid);
  };

  const imageSrc = resolveImageSrc(project.imageUrl);
  const creatorAddress =
    project.creatorAddress ?? project.creatorId ?? project.creator;
  const creatorName =
    project.creator && !project.creator.startsWith("0x")
      ? project.creator
      : "Unknown Creator";

  const getAiHint = (category: string) => {
    switch (category.toLowerCase()) {
      case "food":
        return "food tech";
      case "transport":
        return "future transport";
      case "defi":
        return "blockchain";
      case "gaming":
        return "vr gaming";
      case "entertainment":
        return "future entertainment";
      default:
        return "tech project";
    }
  };

  const shouldShowStatus =
    showStatus &&
    (!onlyShowCompletedStatus ||
      (onlyShowCompletedStatus &&
        (project.status === "funded" ||
          project.status === "completed" ||
          project.status === "active" ||
          project.status === "raising" ||
          project.status === "failed" ||
          project.status === "refunding")));

  return (
    <div
      className="project-card-wrapper"
      onClick={() => openProjectDetails(project)}
    >
      <Card className="project-card flex flex-col overflow-hidden h-full transition-transform transform hover:shadow-xl cursor-pointer gap-2 w-full">
        <CardHeader className="p-0 relative shrink-0 w-full">
          {shouldShowStatus && <StatusBadge status={project.status} />}
          <div className="relative h-40 w-full">
            <ImageWithFallback
              src={imageSrc || ""}
              alt={project.title}
              className="w-full h-full object-cover"
              data-ai-hint={getAiHint(project.category)}
              fill
            />
          </div>
        </CardHeader>
        <div className="px-4 pb-2 shrink-0 w-full">
          <Progress value={fundingPercentage} className="h-2" />
        </div>
        <CardContent className="p-4 pt-0 flex-grow flex flex-col justify-start min-h-0 w-full overflow-hidden">
          <div className="flex-grow min-w-0 w-full">
            <CardTitle className="text-lg font-bold mb-1 font-headline leading-tight break-all line-clamp-2 w-full">
              {project.title}
            </CardTitle>
            <CardDescription className="text-sm project-tagline break-words whitespace-normal line-clamp-3 w-full">
              {project.tagline}
            </CardDescription>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between items-center p-4 pt-0 shrink-0 w-full gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={project.creatorAvatar} alt={project.creator} />
              <AvatarFallback>{project.creator.charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 leading-tight">
              <div
                className="text-sm font-semibold text-foreground truncate"
                title={creatorName}
              >
                {creatorName}
              </div>
              <div
                className="text-[11px] text-muted-foreground truncate"
                title={creatorAddress}
              >
                {shortenAddress(creatorAddress)}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="text-sm font-bold text-accent">
              {fundingPercentage.toFixed(0)}%
            </span>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
