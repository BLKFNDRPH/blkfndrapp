"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Laptop },
] as const;

/**
 * Light, dark or system, as items in a dropdown menu. Applies on selection,
 * like the drawer and Settings do. Used in the account menu, and in the
 * signed-out theme button, so the theme can be changed on a desktop without
 * the drawer, which is the phone's menu now (QA Cycle 7, BF-118).
 */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  // next-themes knows the stored theme only in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">Appearance</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
        {THEMES.map(({ value, label, Icon }) => (
          <DropdownMenuRadioItem key={value} value={value} className="cursor-pointer">
            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** For a signed-out visitor on a desktop, who has no account menu to hold the theme. */
export function ThemeButton({ className }: { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("shrink-0 rounded-full", className)}>
          <Sun className="h-5 w-5 dark:hidden" aria-hidden="true" />
          <Moon className="hidden h-5 w-5 dark:block" aria-hidden="true" />
          <span className="sr-only">Appearance</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <ThemeMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
