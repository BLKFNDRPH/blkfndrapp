/**
 * Whether a listing's words are words, before they are written into a vault
 * for good (QA Cycle 7, BF-117: "dwxaqsxwdfq" / "gtrweunjr" went through with
 * only the character counters in the way).
 *
 * Deliberately narrow. It catches keyboard mash, placeholder text and a title
 * pasted in twice (BF-078), and nothing that is merely unusual: brand names,
 * acronyms, Filipino and other non-English words all pass. The form shows
 * these as warnings while drafting and refuses to open the vault until they
 * are fixed. Self-contained, so `npm test` runs it.
 */

export type ListingTextField = "title" | "tagline" | "description";

export interface ListingTextProblem {
  field: ListingTextField;
  message: string;
}

const LABEL: Record<ListingTextField, string> = { title: "title", tagline: "tagline", description: "description" };

const VOWELS = /[aeiouy]/;
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** Four keys in a row on a keyboard, either way: "asdf", "fdsa", "wert". */
function hasKeyboardRun(word: string): boolean {
  for (const row of KEYBOARD_ROWS) {
    const reversed = [...row].reverse().join("");
    for (let i = 0; i + 4 <= word.length; i++) {
      const piece = word.slice(i, i + 4);
      if (row.includes(piece) || reversed.includes(piece)) return true;
    }
  }
  return false;
}

/**
 * A word no language writes: almost no vowels, a long run of consonants, or
 * several consonant clusters with few vowels between them. Words under five
 * letters are never judged, and nor are all-capital ones up to six, which are
 * acronyms (IoT, SMS, BRAINS).
 */
export function looksLikeMash(raw: string): boolean {
  if (raw.length < 5) return false;
  if (raw === raw.toUpperCase() && raw.length <= 6) return false;
  const word = raw.toLowerCase();
  if (hasKeyboardRun(word)) return true;
  const letters = [...word];
  const vowels = letters.filter((c) => VOWELS.test(c)).length;
  const ratio = vowels / letters.length;
  const runs = word.split(/[aeiouy]+/).filter(Boolean);
  const longestRun = Math.max(0, ...runs.map((r) => r.length));
  const clusters = runs.filter((r) => r.length >= 3).length;
  return ratio < 0.2 || longestRun >= 5 || (clusters >= 2 && ratio < 0.3);
}

/** Text that stands in for real text. */
const PLACEHOLDERS = new Set([
  "test",
  "testing",
  "test test",
  "asdf",
  "qwerty",
  "sample",
  "sample text",
  "title",
  "tagline",
  "description",
  "lorem ipsum",
  "placeholder",
  "todo",
  "tbd",
  "n a",
  "xxx",
]);

const words = (text: string) => text.split(/[^\p{L}]+/u).filter(Boolean);

/**
 * The same run of `n` words appearing twice, as text pasted in twice does.
 * Three words for a title or tagline; twelve for a description, which can
 * fairly say "stage one buys the pump" more than once but not a whole
 * sentence (three live descriptions were pasted in four to six times).
 */
function repeatsItself(text: string, n: number): boolean {
  const w = words(text.toLowerCase());
  const seen = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) {
    const gram = w.slice(i, i + n).join(" ");
    if (seen.has(gram)) return true;
    seen.add(gram);
  }
  return false;
}

/** The problem with one piece of listing text, in words the builder can act on, or null. */
export function textProblem(field: ListingTextField, text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const label = LABEL[field];

  const normalised = words(trimmed.toLowerCase()).join(" ");
  if (PLACEHOLDERS.has(normalised) || /^lorem ipsum/.test(normalised))
    return `The ${label} looks like placeholder text. Say what the project is.`;

  // Letters only: "Stay tuned...." and "----" dividers are fine in a description.
  if (/(\p{L})\1{3,}/u.test(trimmed)) return `The ${label} has a letter repeated over and over.`;

  // Every word that's long enough to judge, and how many look like mash.
  const judged = words(trimmed).filter((w) => w.length >= 4);
  const mash = judged.filter(looksLikeMash);
  if (mash.length > 0 && mash.length * 2 >= judged.length)
    return `The ${label} doesn't read as words ("${mash[0]}"). Write it the way you'd describe the project to a stakeholder.`;

  if (repeatsItself(trimmed, field === "description" ? 12 : 3))
    return `The ${label} repeats itself. Check it was only pasted in once.`;

  return null;
}

/** Every problem with a listing's text. Empty when it reads as written by a person. */
export function listingTextProblems(text: Record<ListingTextField, string>): ListingTextProblem[] {
  const out: ListingTextProblem[] = [];
  for (const field of ["title", "tagline", "description"] as const) {
    const message = textProblem(field, text[field] ?? "");
    if (message) out.push({ field, message });
  }
  return out;
}
