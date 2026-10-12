"use client";

import { useEffect, useRef } from "react";

/** Resolves once the page has loaded and the main thread has had a quiet moment. */
function whenPageSettled(): Promise<void> {
  return new Promise((resolve) => {
    const idle = () => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => resolve(), { timeout: 3000 });
      } else {
        window.setTimeout(resolve, 1500);
      }
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}

/**
 * Lets a decorative animation run only when it costs the visitor nothing.
 *
 * The home page's hero ran 26 SVG animations from the first frame: a full-hero
 * SVG repainting its stroke-dashoffset and a vault illustration whose SVG
 * transforms the GPU cannot take over. On a throttled phone that was most of
 * 7.7 s of main-thread work, competing with the first paint and hydration.
 *
 * The element gets `data-motion="on"` only after the page has loaded and gone
 * idle, and only while it is on screen; its CSS holds a still frame until then.
 * Reduced motion is left to the CSS, which never animates.
 */
export function useDeferredMotion<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let settled = false;
    let visible = false;
    let cancelled = false;
    const apply = () => {
      if (settled && visible) element.dataset.motion = "on";
      else delete element.dataset.motion;
    };

    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            apply();
          })
        : null;
    if (observer) observer.observe(element);
    else visible = true;

    whenPageSettled().then(() => {
      if (cancelled) return;
      settled = true;
      apply();
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  return ref;
}
