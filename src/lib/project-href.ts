/**
 * The one place that knows where a project lives.
 *
 * Projects used to open in a dialog over whichever page you were on, with the
 * id tucked into a ?project= query. They are pages now, so a project has an
 * address you can share, bookmark, open in a new tab and come back to with
 * the browser's back button. Every link to a project builds it from here.
 */

export const PROJECTS_PATH = "/projects";

export type ProjectTab = "overview" | "stages" | "record" | "builder";

/** "/projects/4", or "/projects/4?tab=stages". */
export function projectHref(
  id: string | number,
  options?: { tab?: ProjectTab; stake?: boolean },
): string {
  const base = `${PROJECTS_PATH}/${encodeURIComponent(String(id))}`;
  const params = new URLSearchParams();
  if (options?.tab && options.tab !== "overview") params.set("tab", options.tab);
  // ?stake=1 opens the stake sheet on arrival, for links that mean "stake in
  // this project" (a notification, a search result's Stake button).
  if (options?.stake) params.set("stake", "1");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** The id in a legacy "/projects?project=<id>" link, or null. */
export function legacyProjectParam(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get("project");
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}
