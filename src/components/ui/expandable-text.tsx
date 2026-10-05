"use client";

import { useId, useLayoutEffect, useState } from "react";
import { Button } from "./button";

/**
 * Whether a line-clamped element is hiding some of its text, kept current as
 * the element resizes. `text` is what it shows, so new text is measured again;
 * `active` is false while it is not clamped.
 *
 * Takes the element itself, from a callback ref, not a ref object: a Radix
 * dialog mounts its content a render after it opens, and an effect reading a
 * ref object in the opening render finds nothing and never runs again.
 */
export function useIsClamped(
  el: HTMLElement | null,
  text: string | undefined,
  active = true,
): boolean {
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    if (!el || !active) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, text, active]);

  return clamped;
}

/**
 * Long text as a preview of a few lines with a Read more toggle.
 *
 * It replaces a fixed-height box with its own scrollbar inside a dialog that
 * also scrolls: the scroll got trapped on trackpads and phones, and most of the
 * text sat out of sight. Line breaks the author typed are kept, and a long run
 * with no spaces wraps instead of widening its container.
 */
export function ExpandableText({
  text,
  lines = 6,
  className,
}: {
  text: string;
  /** Lines shown before Read more. */
  lines?: number;
  className?: string;
}) {
  const [el, setEl] = useState<HTMLParagraphElement | null>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const clamped = useIsClamped(el, text, !expanded);

  const toggle = () => {
    // Folding a long text back up can leave the reader far below it.
    if (expanded) {
      requestAnimationFrame(() => el?.scrollIntoView({ block: "nearest" }));
    }
    setExpanded(!expanded);
  };

  return (
    <div className={className}>
      <p
        ref={setEl}
        id={id}
        className="m-0 whitespace-pre-line [overflow-wrap:anywhere]"
        style={
          expanded
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
              }
        }
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 pt-1"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={toggle}
        >
          {expanded ? "Show less" : "Read more"}
        </Button>
      )}
    </div>
  );
}
