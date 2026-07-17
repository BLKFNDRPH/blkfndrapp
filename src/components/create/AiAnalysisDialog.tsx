"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '../ui/badge';
import { CheckCircle, AlertTriangle, Star } from 'lucide-react';
import { Progress } from '../ui/progress';
import type { ImproveListingQualityOutput } from '@/ai/flows/improve-listing-quality';

interface AiAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: ImproveListingQualityOutput;
}

export function AiAnalysisDialog({ open, onOpenChange, result }: AiAnalysisDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="text-yellow-400" />
            AI Listing Quality Analysis
          </DialogTitle>
          <DialogDescription>
            Here are some suggestions to improve your project listing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Overall Quality Score</h3>
            <div className="flex items-center gap-4">
               <Progress value={result.overallQualityScore} className="h-3" />
               <span className="font-bold text-lg">{result.overallQualityScore}/100</span>
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-3">Suggestions for Improvement</h3>
            <ul className="space-y-2">
              {result.suggestions.map((suggestion: string, index: number) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <span>{suggestion}</span>
                </li>
              ))}
            </ul>
          </div>

          {result.flags.length > 0 && (
            <div>
              <h3 className="font-semibold mb-3">Potential Issues</h3>
              <ul className="space-y-2">
                {result.flags.map((flag: string, index: number) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
