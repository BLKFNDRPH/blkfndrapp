import { test } from "node:test";
import assert from "node:assert/strict";
import { walletDeadline, walletlessStage, WALLETLESS_EXPIRED_REASON } from "./walletless.ts";

const approved = "2026-10-14T08:09:33Z";
const after = (days: number, hours = 0) => new Date(new Date(approved).getTime() + (days * 24 + hours) * 3600_000);

test("the deadline is 30 days after the approval", () => {
  assert.equal(walletDeadline(approved).toISOString(), "2026-11-13T08:09:33.000Z");
});

test("nothing is due in the first week", () => {
  assert.deepEqual(walletlessStage(approved, after(0)), { stage: "waiting" });
  assert.deepEqual(walletlessStage(approved, after(6, 23)), { stage: "waiting" });
});

test("reminded from day 7, then from day 25, with the days left", () => {
  assert.deepEqual(walletlessStage(approved, after(7)), { stage: "remind", day: 7, daysLeft: 23 });
  assert.deepEqual(walletlessStage(approved, after(24, 23)), { stage: "remind", day: 7, daysLeft: 6 });
  assert.deepEqual(walletlessStage(approved, after(25)), { stage: "remind", day: 25, daysLeft: 5 });
  assert.deepEqual(walletlessStage(approved, after(29, 23)), { stage: "remind", day: 25, daysLeft: 1 });
});

test("expired from the 30th day on", () => {
  assert.deepEqual(walletlessStage(approved, after(30)), { stage: "expired" });
  assert.deepEqual(walletlessStage(approved, after(400)), { stage: "expired" });
});

test("only the latest reminder is due, so a late first scan doesn't send both", () => {
  const stage = walletlessStage(approved, after(26));
  assert.equal(stage.stage === "remind" && stage.day, 25);
});

test("the expiry reason says what happened, not that the document was refused", () => {
  assert.match(WALLETLESS_EXPIRED_REASON, /No wallet was attached within 30 days/);
});
