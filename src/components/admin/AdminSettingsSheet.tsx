
"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Settings } from "lucide-react";
import { Separator } from "../ui/separator";
import { PlatformFeeForm } from "./PlatformFeeForm";
import { PerformanceBondForm } from "./PerformanceBondForm";
import { FeeContactForm } from "./FeeContactForm";

export function AdminSettingsSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="lg">
          <Settings className="mr-2 h-5 w-5" />
          Settings
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Platform Settings</SheetTitle>
          <SheetDescription>
            Manage the on-chain configurations for platform fees and equity.
          </SheetDescription>
        </SheetHeader>
        <div className="py-8 space-y-8">
          <PlatformFeeForm />
          <Separator />
          <PerformanceBondForm />
          <Separator />
          <FeeContactForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}
