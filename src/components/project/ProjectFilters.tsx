"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Label } from '../ui/label';
import { formatCurrency } from '@/lib/formatters';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Settings, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Checkbox } from '../ui/checkbox';

interface ProjectFiltersProps {
  sortBy: string;
  onSortByChange: (value: string) => void;
  goalFilter: number;
  onGoalFilterChange: (value: number) => void;
  maxGoal: number;
  showPending: boolean;
  onShowPendingChange: (checked: boolean) => void;
}

const calculateStep = (max: number): number => {
    if (max <= 1000) return 1;
    if (max <= 10000) return 500;
    if (max <= 100000) return 5000;
    return 10000;
}

export function ProjectFilters({
  sortBy,
  onSortByChange,
  goalFilter,
  onGoalFilterChange,
  maxGoal,
  showPending,
  onShowPendingChange,
}: ProjectFiltersProps) {
  const step = calculateStep(maxGoal);

  return (
    <Card className="mb-8">
        <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-6 items-center">
                <div>
                <Label className="mb-2 block">Sort By</Label>
                <Select value={sortBy} onValueChange={onSortByChange}>
                    <SelectTrigger className="w-full">
                    <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                    <SelectItem value="relevance">Relevance</SelectItem>
                    <SelectItem value="latest">Latest</SelectItem>
                    <SelectItem value="popularity">Popularity</SelectItem>
                    </SelectContent>
                </Select>
                </div>
                <div>
                <Label htmlFor="funding-goal-slider" className="mb-2 block">
                    Funding Goal up to: {goalFilter.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </Label>
                    <Slider
                    id="funding-goal-slider"
                    min={0}
                    max={maxGoal || 1}                          // ← add this
                    step={step}
                    value={[Math.min(goalFilter, maxGoal || 1)]} // ← and this
                    onValueChange={(value) => onGoalFilterChange(value[0])}
                    disabled={maxGoal === 0}                    // ← and this
                    />
                </div>
                <div className="self-end">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Advanced Settings">
                                <Settings className="h-5 w-5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none">Advanced Settings</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Adjust visibility settings for projects.
                                    </p>
                                </div>
                                <div className="grid gap-2">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox 
                                            id="show-pending" 
                                            checked={showPending}
                                            onCheckedChange={onShowPendingChange}
                                        />
                                        <Label htmlFor="show-pending">Show Pending Projects</Label>
                                    </div>
                                    <div className="flex items-start gap-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded-md border border-dashed">
                                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                                        <span>
                                            Pending projects have not been reviewed or verified by the platform administrators. Proceed with caution.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>
        </CardContent>
    </Card>
  );
}