/**
 * Placeholder cards for the featured row while projects load.
 *
 * Replaces the full-screen loader on the home page: a visitor should see the
 * page shape and keep reading the hero while the list arrives, not a blocking
 * animation. Three cards on desktop, one on a phone, matching the real row.
 */
export function FeaturedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading projects"
      className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={
            i === 0
              ? "flex flex-col overflow-hidden rounded-xl border bg-card"
              : "hidden flex-col overflow-hidden rounded-xl border bg-card md:flex"
          }
          aria-hidden="true"
        >
          <div className="aspect-[16/9] w-full animate-pulse bg-muted" />
          <div className="space-y-3 p-5">
            <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-muted" />
            <div className="flex items-center justify-between pt-1">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading projects…</span>
    </div>
  );
}
