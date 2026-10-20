import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDeadline, formatDeadlineDate } from "./project-status.ts";

// Mid-year, midday UTC, so the calendar day is the same in every time zone
// the test might run in. October, because ICU spells September "Sept" in
// en-GB and the month's spelling is not what is under test.
const now = Date.UTC(2026, 5, 15, 12);
const sameYear = Date.UTC(2026, 9, 15, 12);
const nextYear = Date.UTC(2027, 9, 15, 12);
const lastYear = Date.UTC(2025, 9, 15, 12);

test("a deadline this year reads without its year", () => {
  assert.equal(formatDeadlineDate(sameYear, now), "15 Oct");
});

test("a deadline in another year carries the year", () => {
  assert.equal(formatDeadlineDate(nextYear, now), "15 Oct 2027");
  assert.equal(formatDeadlineDate(lastYear, now), "15 Oct 2025");
});

test("the year follows the calendar, not the distance", () => {
  // Two weeks out, but across New Year: the year still shows.
  const lateDecember = Date.UTC(2026, 11, 20, 12);
  const earlyJanuary = Date.UTC(2027, 0, 3, 12);
  assert.equal(formatDeadlineDate(earlyJanuary, lateDecember), "3 Jan 2027");
  // Fourteen months out is "445 days left" and a dated year beside it.
  const demoDeadline = Date.UTC(2027, 11, 31, 12);
  const demoDay = Date.UTC(2026, 9, 12, 12);
  assert.equal(formatDeadlineDate(demoDeadline, demoDay), "31 Dec 2027");
  assert.equal(describeDeadline(demoDeadline, demoDay)?.label, "445 days left");
});
