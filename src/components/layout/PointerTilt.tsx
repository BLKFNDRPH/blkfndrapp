"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Tilts its content in 3D towards the pointer, the way the old cube avatar
 * did: up to `maxDeg` either way, from where the pointer sits in the window.
 * The rotation is written straight to the element once per frame rather than
 * through state, so a mouse move doesn't re-render the header. Still for
 * anyone who asks for reduced motion.
 */
export function PointerTilt({
  children,
  className,
  maxDeg = 20,
}: {
  children: React.ReactNode;
  className?: string;
  maxDeg?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      const rotateY = (x / window.innerWidth - 0.5) * 2 * maxDeg;
      const rotateX = -(y / window.innerHeight - 0.5) * 2 * maxDeg;
      if (ref.current) {
        ref.current.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      }
    };
    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [maxDeg]);

  return (
    <div className={cn("[perspective:400px]", className)}>
      <div
        ref={ref}
        className="transition-transform duration-150 ease-out [transform-style:preserve-3d]"
      >
        {children}
      </div>
    </div>
  );
}
