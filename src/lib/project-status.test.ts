import { test } from "node:test";
import assert from "node:assert/strict";
import { describeDeadline, describeDeposit, formatDeadlineDate } from "./project-status.ts";

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

// #2, #10, #22 and #28 are the vaults behind the 21 Oct 2026 screenshots, with
// the flag each one answered.

test("a deposit is locked while the vault is raising or building", () => {
  // #22, raising.
  assert.equal(
    describeDeposit({ status: "raising", bondReturned: false }, "$275"),
    "Builder's deposit $275 locked",
  );
  assert.equal(
    describeDeposit({ status: "active", bondReturned: false }, "$300"),
    "Builder's deposit $300 locked",
  );
  assert.equal(describeDeposit({ status: "funded" }, "$300"), "Builder's deposit $300 locked");
});

test("a missed goal's deposit reads returned once the vault hands it back", () => {
  // #28 (2.5 USDC) and #2 (50 XLM): the keeper ran return_bond.
  assert.equal(
    describeDeposit({ status: "failed", bondReturned: true }, "$2.50"),
    "Builder's deposit $2.50 returned",
  );
  assert.equal(
    describeDeposit({ status: "failed", bondReturned: true }, "50 XLM"),
    "Builder's deposit 50 XLM returned",
  );
});

test("a missed goal's deposit still in the vault is not called locked", () => {
  const due = "Builder's deposit $2.50 goes back to the builder";
  assert.equal(describeDeposit({ status: "failed", bondReturned: false }, "$2.50"), due);
  // The indexed copy has no flag; the line has to hold either way.
  assert.equal(describeDeposit({ status: "failed" }, "$2.50"), due);
  assert.equal(describeDeposit({ status: "expired" }, "$2.50"), due);
});

test("a forfeited deposit is set aside for stakeholders, then paid out", () => {
  // Refunds still to collect: bond_returned is false.
  assert.equal(
    describeDeposit({ status: "refunding", bondReturned: false }, "$300"),
    "Builder's deposit $300 set aside for stakeholders",
  );
  assert.equal(
    describeDeposit({ status: "refunding" }, "$300"),
    "Builder's deposit $300 set aside for stakeholders",
  );
  // #10: its one stakeholder collected, and the last refund swept the deposit.
  assert.equal(
    describeDeposit({ status: "refunding", bondReturned: true }, "$300"),
    "Builder's deposit $300 paid out to stakeholders",
  );
});

test("a completed vault's deposit went back with the last payout", () => {
  assert.equal(
    describeDeposit({ status: "completed", bondReturned: true }, "$300"),
    "Builder's deposit $300 returned",
  );
  // The last payout always returns it, so the status alone is enough.
  assert.equal(describeDeposit({ status: "completed" }, "$300"), "Builder's deposit $300 returned");
});
