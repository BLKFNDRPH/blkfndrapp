"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { Landmark } from "lucide-react";

/**
 * "Open a vault" — the one entry point to the listing form.
 *
 * Signed out, it opens the sign-in dialog instead of bouncing to a page that
 * would do the same thing less politely. `variant="nav"` is the desktop text
 * link; `variant="menu"` is the row in the hamburger sheet.
 */
export function CreateListingButton({
  className,
  onAfterClick,
  variant = "nav",
}: {
  className?: string;
  onAfterClick?: () => void;
  variant?: "nav" | "menu";
}) {
  const { user, login, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleCreateClick = () => {
    if (user) {
      router.push("/create-listing");
    } else {
      login();
    }
    onAfterClick?.();
  };

  const isActive = pathname === "/create-listing";

  if (variant === "menu") {
    return (
      <button
        type="button"
        onClick={handleCreateClick}
        disabled={loading}
        className={cn("flex w-full items-center", className)}
      >
        <Landmark className="h-5 w-5" aria-hidden="true" />
        <span>Open a vault</span>
      </button>
    );
  }

  return (
    <Button
      type="button"
      onClick={handleCreateClick}
      disabled={loading}
      variant={isActive ? "secondary" : "ghost"}
      className={cn(
        "whitespace-nowrap text-sm font-medium transition-colors",
        !isActive && "text-foreground/70 hover:text-foreground",
        className,
      )}
    >
      Open a vault
    </Button>
  );
}
