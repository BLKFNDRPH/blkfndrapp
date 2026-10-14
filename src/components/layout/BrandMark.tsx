import Image from "next/image";
import { cn } from "@/lib/utils";
import { PointerTilt } from "./PointerTilt";

/**
 * The BLKFNDR emblem on its dark tile, as in the favicon. The gold emblem is
 * drawn for a dark background, so the tile keeps it legible in light theme.
 * The file is already sized for a 2x screen, so it skips the image optimizer.
 * It tilts towards the pointer, as the cube avatar it replaced did.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <PointerTilt className="shrink-0">
      <Image
        src="/brand/blkfndr-mark.png"
        alt=""
        width={96}
        height={96}
        unoptimized
        priority
        className={cn("h-9 w-9 sm:h-10 sm:w-10", className)}
      />
    </PointerTilt>
  );
}
