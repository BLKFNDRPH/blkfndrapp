import { test } from "node:test";
import assert from "node:assert/strict";
import { isSelfReview } from "./self-review.ts";

const reviewer = "6f1c2a7e-0b4d-4f3a-9c1e-2d5b8a9e7f10";
const applicant = "0a9b8c7d-6e5f-4a3b-2c1d-0e9f8a7b6c5d";

test("a reviewer's own check is self-review", () => {
  assert.equal(isSelfReview(reviewer, reviewer), true);
});

test("someone else's check is not", () => {
  assert.equal(isSelfReview(reviewer, applicant), false);
});

test("a missing applicant never matches", () => {
  assert.equal(isSelfReview(reviewer, null), false);
  assert.equal(isSelfReview(reviewer, undefined), false);
  assert.equal(isSelfReview("", ""), false);
});
