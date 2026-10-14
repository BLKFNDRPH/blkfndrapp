import { test } from "node:test";
import assert from "node:assert/strict";
import { kycDetailProblems, kycServerToday, namesDiffer, type KycRulesInput, type KycToday } from "./rules.ts";

const today: KycToday = { forExpiry: "2026-10-09", forAge: "2026-10-09" };

const valid: KycRulesInput = {
  fullName: "Kira Lhyn Calizo",
  idNumber: "P1234567A",
  dateOfBirth: "1994-03-15",
  documentExpiresOn: "2031-03-14",
  residentialAddress: "12 Rizal St, Brgy. San Antonio, Makati City, Philippines",
};

test("a real-looking check passes", () => {
  assert.deepEqual(kycDetailProblems(valid, today), {});
});

test("the QA Cycle 7 payload is refused on every field (BF-108)", () => {
  const problems = kycDetailProblems(
    {
      fullName: "Adam Johnson",
      idNumber: "Asd*&$^12376",
      dateOfBirth: "2026-10-09",
      documentExpiresOn: "2026-10-09",
      residentialAddress: "2435645645tfsvbfhgswdfb",
    },
    today,
  );
  assert.deepEqual(Object.keys(problems).sort(), [
    "dateOfBirth",
    "documentExpiresOn",
    "idNumber",
    "residentialAddress",
  ]);
  assert.match(problems.documentExpiresOn!, /expires today/);
});

test("expiry must be after today, not on it (BF-109)", () => {
  assert.ok(kycDetailProblems({ ...valid, documentExpiresOn: "2026-10-09" }, today).documentExpiresOn);
  assert.ok(kycDetailProblems({ ...valid, documentExpiresOn: "2026-10-08" }, today).documentExpiresOn);
  assert.equal(kycDetailProblems({ ...valid, documentExpiresOn: "2026-10-10" }, today).documentExpiresOn, undefined);
});

test("18 on the day of the birthday, not the day before", () => {
  assert.equal(kycDetailProblems({ ...valid, dateOfBirth: "2008-10-09" }, today).dateOfBirth, undefined);
  assert.ok(kycDetailProblems({ ...valid, dateOfBirth: "2008-10-10" }, today).dateOfBirth);
});

test("born on 29 February turns 18 on 1 March in a common year, as the form always counted", () => {
  const leap = { ...valid, dateOfBirth: "2008-02-29" };
  assert.ok(kycDetailProblems(leap, { forExpiry: "2026-02-28", forAge: "2026-02-28" }).dateOfBirth);
  assert.equal(kycDetailProblems(leap, { forExpiry: "2026-03-01", forAge: "2026-03-01" }).dateOfBirth, undefined);
  // A 29 February today in a leap year counts back to 28 February 18 years before.
  assert.equal(
    kycDetailProblems({ ...valid, dateOfBirth: "2010-02-28" }, { forExpiry: "2028-02-29", forAge: "2028-02-29" }).dateOfBirth,
    undefined,
  );
});

test("impossible dates are refused", () => {
  assert.ok(kycDetailProblems({ ...valid, dateOfBirth: "1990-02-30" }, today).dateOfBirth);
  assert.ok(kycDetailProblems({ ...valid, documentExpiresOn: "9999-01-01" }, today).documentExpiresOn);
  assert.ok(kycDetailProblems({ ...valid, dateOfBirth: "15/03/1994" }, today).dateOfBirth);
});

test("document numbers: printed characters only, with a digit", () => {
  for (const ok of ["P1234567A", "N01-23-456789", "1234 5678 9012"]) {
    assert.equal(kycDetailProblems({ ...valid, idNumber: ok }, today).idNumber, undefined, ok);
  }
  for (const bad of ["Asd*&$^12376", "ABCDEFG", "12", "1".repeat(31), "<script>1</script>"]) {
    assert.ok(kycDetailProblems({ ...valid, idNumber: bad }, today).idNumber, bad);
  }
});

test("names: any script and the punctuation names carry", () => {
  for (const ok of ["José María Núñez-O'Brien", "Ma. Cristina Dela Cruz", "Nguyễn Thị Minh", "Soekarno", "山田 太郎"]) {
    assert.equal(kycDetailProblems({ ...valid, fullName: ok }, today).fullName, undefined, ok);
  }
  for (const bad of ["Adam123", "x", "-Adam", "Adam <b>"]) {
    assert.ok(kycDetailProblems({ ...valid, fullName: bad }, today).fullName, bad);
  }
});

test("addresses need more than one word and some letters", () => {
  assert.ok(kycDetailProblems({ ...valid, residentialAddress: "2435645645tfsvbfhgswdfb" }, today).residentialAddress);
  assert.ok(kycDetailProblems({ ...valid, residentialAddress: "123 456 789 0" }, today).residentialAddress);
  assert.equal(kycDetailProblems({ ...valid, residentialAddress: "5 Main St, Manila" }, today).residentialAddress, undefined);
});

test("the server's day is never stricter than the applicant's own clock", () => {
  // 9 Oct 2026 06:00 UTC: already 10 Oct at UTC+14, still 8 Oct at UTC-12.
  const server = kycServerToday(new Date("2026-10-09T06:00:00Z"));
  assert.deepEqual(server, { forExpiry: "2026-10-08", forAge: "2026-10-09" });
  // Someone at UTC-11 whose ID expires tomorrow on their clock (9 Oct) passes.
  assert.equal(kycDetailProblems({ ...valid, documentExpiresOn: "2026-10-09" }, server).documentExpiresOn, undefined);
  // Someone at UTC+14 turning 18 today on their clock (10 Oct) passes.
  const late = kycServerToday(new Date("2026-10-09T12:00:00Z"));
  assert.equal(kycDetailProblems({ ...valid, dateOfBirth: "2008-10-10" }, late).dateOfBirth, undefined);
});

test("a name that differs from the account's is flagged, a shortened one is not (BF-110)", () => {
  assert.equal(namesDiffer("Adam Johnson", "Kira Lhyn Calizo"), true);
  assert.equal(namesDiffer("Kira Lhyn Calizo", "Kira Calizo"), false);
  assert.equal(namesDiffer("José Núñez", "jose nunez"), false);
  assert.equal(namesDiffer("Kira Lhyn Calizo", ""), false);
});
