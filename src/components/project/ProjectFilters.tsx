"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "../ui/label";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Checkbox } from "../ui/checkbox";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The Filters card on Explore: sort, a goal ceiling in dollars, and the one
 * advanced switch that shows listings BLKFNDR has not yet reviewed.
 *
 * Every figure is a dollar figure. An XLM vault's goal is converted at the live
 * rate by the page before it gets here, which is why the slider says "≈ for XLM
 * vaults": the ceiling is exact for dollar vaults and an estimate for the rest.
 */

/** The sort keys the Explore page knows how to apply. */
export type ProjectSortKey = "popularity" | "latest" | "ending";

export const SORT_OPTIONS: { value: ProjectSortKey; label: string }[] = [
  { value: "popularity", label: "Most staked" },
  { value: "latest", label: "Newest" },
  { value: "ending", label: "Ending soon" },
];

export const UNREVIEWED_LABEL = "Show unreviewed listings";
export const UNREVIEWED_HELPER =
  "These haven't been through BLKFNDR's listing review yet. The vault rules still apply to them; the description is unverified.";

interface ProjectFiltersProps {
  sortBy: ProjectSortKey;
  onSortByChange: (value: ProjectSortKey) => void;
  /** The goal ceiling, in dollars. */
  goalFilter: number;
  onGoalFilterChange: (value: number) => void;
  /** The largest goal on the page, in dollars; the slider's top. */
  maxGoal: number;
  showUnreviewed: boolean;
  onShowUnreviewedChange: (checked: boolean) => void;
  /** Drop the card chrome, for use inside a sheet that has its own. */
  embedded?: boolean;
  className?: string;
}

/** A slider step that gives a few dozen stops whatever the largest goal is. */
export const goalStep = (max: number): number => {
  if (max <= 1_000) return 50;
  if (max <= 10_000) return 250;
  if (max <= 100_000) return 1_000;
  if (max <= 1_000_000) return 10_000;
  return 50_000;
};

function isSortKey(value: string): value is ProjectSortKey {
  return SORT_OPTIONS.some((o) => o.value === value);
}

export function ProjectFilters({
  sortBy,
  onSortByChange,
  goalFilter,
  onGoalFilterChange,
  maxGoal,
  showUnreviewed,
  onShowUnreviewedChange,
  embedded = false,
  className,
}: ProjectFiltersProps) {
  const step = goalStep(maxGoal);
  const top = Math.max(step, Math.ceil(maxGoal / step) * step);
  const value = Math.min(goalFilter, top);

  const body = (
    <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1fr_1fr_auto]">
      <div>
        <Label htmlFor="sort-by" className="mb-2 block">
          Sort by
        </Label>
        <Select
          value={sortBy}
          onValueChange={(v) => {
            if (isSortKey(v)) onSortByChange(v);
          }}
        >
          <SelectTrigger id="sort-by" className="w-full">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="goal-slider" className="mb-2 block">
          Goal up to {formatUsd(value, "never")}
        </Label>
        <Slider
          id="goal-slider"
          min={0}
          max={top}
          step={step}
          value={[value]}
          onValueChange={(v) => onGoalFilterChange(v[0])}
          disabled={maxGoal <= 0}
          aria-label="Goal up to"
        />
        <p className="mt-2 text-xs text-muted-foreground">≈ for XLM vaults</p>
      </div>

      <div className="md:self-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Settings2 className="h-4 w-4" aria-hidden="true" />
              Advanced
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="grid gap-3">
              <h4 className="font-medium leading-none">Advanced</h4>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="show-unreviewed"
                  checked={showUnreviewed}
                  onCheckedChange={(checked) =>
                    onShowUnreviewedChange(checked === true)
                  }
                  className="mt-0.5"
                />
                <div className="grid gap-1">
                  <Label htmlFor="show-unreviewed" className="leading-snug">
                    {UNREVIEWED_LABEL}
                  </Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {UNREVIEWED_HELPER}
                  </p>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );

  if (embedded) return <div className={className}>{body}</div>;

  return (
    <Card className={cn("mb-8", className)}>
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );
}
