/**
 * What an identity check must look like before it reaches a reviewer.
 *
 * One set of rules for the form and the server action. The form runs them for
 * instant feedback; the server runs them again and its answer is the one that
 * counts, because anything the browser checks can be skipped by posting to the
 * action directly (QA Cycle 7, BF-108: a date of birth and an expiry of today,
 * a number full of symbols and an address of keyboard mash all reached the
 * review queue).
 *
 * The rules catch what can't be a real document, not what looks unusual:
 * a reviewer still compares every field with the picture. Self-contained, so
 * `npm test` runs it without the app's module aliases.
 */

export type KycRulesField = "fullName" | "idNumber" | "dateOfBirth" | "documentExpiresOn" | "residentialAddress";

export interface KycRulesInput {
  fullName: string;
  idNumber: string;
  /** YYYY-MM-DD. */
  dateOfBirth: string;
  /** YYYY-MM-DD. */
  documentExpiresOn: string;
  residentialAddress: string;
}

/**
 * Today, as YYYY-MM-DD, for each rule that depends on it.
 *
 * The browser passes its own date for both. The server can't know the
 * applicant's time zone, so it passes the most lenient day anywhere on Earth
 * for each rule (kycServerToday): it must never refuse what the form, on the
 * applicant's own clock, accepted.
 */
export interface KycToday {
  /** Compared with the expiry, which must be after it. */
  forExpiry: string;
  /** Compared with the date of birth, which must be at least 18 years before it. */
  forAge: string;
}

export const MIN_AGE = 18;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD string that names a real calendar day in a plausible range. */
function isRealDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2199) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * The same calendar day `years` earlier; a 29 Feb today falls back to 28 Feb.
 * Someone born on 29 Feb is therefore a year older on 1 Mar in a common year,
 * as the form has always counted.
 */
function yearsBefore(day: string, years: number): string {
  const [y, mo, d] = day.split("-").map(Number);
  const back = new Date(Date.UTC(y - years, mo - 1, d));
  // 29 Feb in a year without one rolls over to 1 Mar; step back to 28 Feb.
  if (back.getUTCMonth() !== mo - 1) back.setUTCDate(0);
  return back.toISOString().slice(0, 10);
}

/** Letters in any script, combining marks, spaces, and the punctuation names carry. */
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

/** Letters, digits, spaces and hyphens: what a document number is printed with. */
const DOCUMENT_NUMBER = /^[A-Za-z0-9 -]+$/;

/**
 * Every problem with the details, by field, in words the applicant can act on.
 * Empty when there are none. Assumes the strings are already trimmed.
 */
export function kycDetailProblems(input: KycRulesInput, today: KycToday): Partial<Record<KycRulesField, string>> {
  const out: Partial<Record<KycRulesField, string>> = {};

  const name = input.fullName.trim();
  if (!name) out.fullName = "Enter your full legal name, as on the document.";
  else if (!NAME.test(name) || (name.match(/\p{L}/gu)?.length ?? 0) < 2)
    out.fullName = "Use letters only, as printed on your document. Hyphens, apostrophes and dots are fine.";

  const number = input.idNumber.trim();
  if (!number) out.idNumber = "Enter the number printed on your document.";
  else if (!DOCUMENT_NUMBER.test(number))
    out.idNumber = "Use only the letters, digits and hyphens printed on your document.";
  else if (number.replace(/[ -]/g, "").length < 4 || number.length > 30 || !/\d/.test(number))
    out.idNumber = "That doesn't look like a document number. Check it against your document.";

  const dob = input.dateOfBirth;
  if (!dob) out.dateOfBirth = "Enter your date of birth.";
  else if (!isRealDay(dob)) out.dateOfBirth = "Enter a real date of birth.";
  else if (dob > yearsBefore(today.forAge, MIN_AGE)) out.dateOfBirth = `You must be ${MIN_AGE} or over.`;

  const expiry = input.documentExpiresOn;
  if (!expiry) out.documentExpiresOn = "Enter the date your document expires.";
  else if (!isRealDay(expiry)) out.documentExpiresOn = "Enter a real expiry date.";
  else if (expiry <= today.forExpiry)
    out.documentExpiresOn =
      expiry === today.forExpiry
        ? "This document expires today. Use one that's still valid after today."
        : "This document has expired. Use one that's still valid.";

  const address = input.residentialAddress.trim();
  const parts = address.split(/[\s,]+/).filter(Boolean);
  if (!address) out.residentialAddress = "Enter your home address.";
  else if (address.length < 10 || parts.length < 2 || (address.match(/\p{L}/gu)?.length ?? 0) < 3)
    out.residentialAddress = "Enter your full home address: street, city and country.";

  return out;
}

/** Today as YYYY-MM-DD on the device's own clock, for the form. */
export function kycLocalToday(now: Date = new Date()): KycToday {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { forExpiry: day, forAge: day };
}

/**
 * For the server: the earliest date anywhere (UTC-12) for the expiry, the
 * latest (UTC+14) for the age. Each is the day on which that rule is easiest
 * to pass, so the server is never stricter than the applicant's own clock.
 */
export function kycServerToday(now: Date = new Date()): KycToday {
  const hours = 60 * 60 * 1000;
  return {
    forExpiry: new Date(now.getTime() - 12 * hours).toISOString().slice(0, 10),
    forAge: new Date(now.getTime() + 14 * hours).toISOString().slice(0, 10),
  };
}

/** The words of a name, lower-case and without accents, for comparison. */
function nameWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

/**
 * Whether the name on a check looks like a different person from the name on
 * the account. Not a refusal -- people go by nicknames and shortened names --
 * but something to put in front of the reviewer. Names are taken to agree
 * when every word of one appears in the other ("Kira Calizo" and "Kira Lhyn
 * Calizo"). False when either name is empty.
 */
export function namesDiffer(legalName: string, accountName: string): boolean {
  const a = nameWords(legalName);
  const b = nameWords(accountName);
  if (a.length === 0 || b.length === 0) return false;
  const inA = new Set(a);
  const inB = new Set(b);
  return !a.every((w) => inB.has(w)) && !b.every((w) => inA.has(w));
}
