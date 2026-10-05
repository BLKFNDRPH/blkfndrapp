/**
 * How long a listing's text may be, in characters.
 *
 * One table for every place that enforces it: the listing form (with a live
 * counter), the upload route that pins the metadata, and the indexer that
 * copies it into the database. If the database is ever made to check these
 * numbers too, they must move together, the database's first: a failed write
 * stops the indexer on that event until it succeeds, which stalls indexing
 * for every project.
 *
 * There were none before. A title of any length was accepted, and a 311-character
 * one filled the card and three lines of the project dialog's header.
 */
export const LISTING_LIMITS = {
  title: 80,
  tagline: 100,
  description: 2000,
  location: 160,
  milestoneTitle: 80,
  milestoneDescription: 500,
} as const;

/**
 * Characters as Postgres counts them (`char_length`): code points, so an emoji
 * is one. A string's `.length` counts UTF-16 units and would call it two, and
 * a counter using it would disagree with the limit the database enforces.
 */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** The first `max` characters of `text`, never splitting an emoji in half. */
export function clampText(text: string, max: number): string {
  if (charCount(text) <= max) return text;
  return Array.from(text).slice(0, max).join("");
}

/** "Title is 311 characters; the limit is 80." */
function overLimit(label: string, text: string, max: number): string | null {
  const count = charCount(text);
  return count > max
    ? `${label} is ${count.toLocaleString("en-US")} characters; the limit is ${max.toLocaleString("en-US")}.`
    : null;
}

/**
 * What in a listing's metadata document is too long, one sentence each, or
 * nothing. Checked by the upload route before it pins the document, because
 * the form's own check runs in the builder's browser and can be skipped.
 */
export function listingTextProblems(metadata: unknown): string[] {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return ["The listing is not a JSON object."];
  }
  const doc = metadata as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : "");

  const problems = [
    overLimit("The title", text(doc.title), LISTING_LIMITS.title),
    overLimit("The tagline", text(doc.tagline), LISTING_LIMITS.tagline),
    overLimit("The description", text(doc.description), LISTING_LIMITS.description),
    overLimit("The location", text(doc.location), LISTING_LIMITS.location),
  ];

  const milestones = Array.isArray(doc.milestones) ? doc.milestones : [];
  milestones.forEach((raw, index) => {
    const m = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    problems.push(
      overLimit(`Milestone ${index + 1}'s title`, text(m.title), LISTING_LIMITS.milestoneTitle),
      overLimit(
        `Milestone ${index + 1}'s description`,
        text(m.description),
        LISTING_LIMITS.milestoneDescription,
      ),
    );
  });

  return problems.filter((p): p is string => p !== null);
}
