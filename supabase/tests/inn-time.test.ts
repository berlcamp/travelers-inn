// Pure unit tests for the inn's clock. Run with:
//   node --experimental-strip-types supabase/tests/inn-time.test.ts
//
// This module exists because the app used to read wall-clock times in the
// PROCESS's zone: right on a Manila laptop, eight hours wrong on the UTC
// server (see src/lib/inn-time.ts). So the point of these tests is not just
// that the maths is right — it is that the answers do NOT depend on where the
// code runs. Every assertion below is an absolute instant or an inn-clock
// reading, never a process-local one, and the suite is run under several
// TZ values by supabase/tests/timezone-independence.mjs.
import assert from "node:assert/strict";
import {
  INN_TIME_ZONE,
  fromInnClock,
  innAddDays,
  innAtHour,
  innClockValue,
  innDateValue,
  innFormatter,
  innHour,
  innParts,
  innSameDay,
  innStartOfDay,
  innTime,
  innWeekday,
} from "../../src/lib/inn-time.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log(`inn-time (${INN_TIME_ZONE}) — process TZ is ${process.env.TZ ?? "unset"}`);

// ---- the reported bug -------------------------------------------------------

test("a walk-in typed as 8:17 PM is stored as 8:17 PM in Manila", () => {
  // The exact case from the field report: the desk typed Aug 17, 8:17 PM and
  // the booking came back reading "Aug 18, 4:17 AM" — the string had been read
  // as 20:17 UTC. 20:17 in Manila is 12:17Z, and nothing else.
  assert.equal(fromInnClock("2026-08-17T20:17").toISOString(), "2026-08-17T12:17:00.000Z");
});

test("and reads back as the same wall clock it was typed as", () => {
  assert.equal(innClockValue(fromInnClock("2026-08-17T20:17")), "2026-08-17T20:17");
});

test("noon is noon at the inn, not noon wherever this runs", () => {
  // checkOutAtNoon() is built on this. setHours(12) on the UTC server was
  // 8 PM in Manila, which could also price a second night.
  assert.equal(
    innAtHour(fromInnClock("2026-08-18T05:30"), 12).toISOString(),
    "2026-08-18T04:00:00.000Z"
  );
});

test("midnight is midnight at the inn — the reporting day does not start at 8 AM", () => {
  assert.equal(
    innStartOfDay(fromInnClock("2026-08-17T20:17")).toISOString(),
    "2026-08-16T16:00:00.000Z"
  );
});

// ---- parsing ----------------------------------------------------------------

test("a bare date is midnight at the inn, not UTC midnight", () => {
  // `new Date("2026-08-18")` is UTC midnight, which is still the 17th in
  // Manila — the trap pricing.checkOutValue was written around.
  assert.equal(fromInnClock("2026-08-18").toISOString(), "2026-08-17T16:00:00.000Z");
  assert.equal(innDateValue(fromInnClock("2026-08-18")), "2026-08-18");
});

test("seconds are accepted, and a space instead of a T", () => {
  assert.equal(fromInnClock("2026-08-17T20:17:45").toISOString(), "2026-08-17T12:17:45.000Z");
  assert.equal(fromInnClock("2026-08-17 20:17").toISOString(), "2026-08-17T12:17:00.000Z");
});

test("a string that already carries a zone is left alone", () => {
  // It is an instant, not a clock reading — re-interpreting it would shift a
  // timestamp that was already unambiguous (this is what makes it safe to feed
  // `created_at` values from Postgres through the same helpers).
  assert.equal(fromInnClock("2026-08-17T12:17:00+00:00").toISOString(), "2026-08-17T12:17:00.000Z");
  assert.equal(fromInnClock("2026-08-17T12:17:00Z").toISOString(), "2026-08-17T12:17:00.000Z");
});

test("garbage stays garbage rather than becoming a plausible wrong date", () => {
  assert.ok(Number.isNaN(fromInnClock("not a date").getTime()));
});

// ---- calendar maths ---------------------------------------------------------

test("innAddDays keeps the wall-clock time on the next date", () => {
  const d = fromInnClock("2026-08-17T20:17");
  assert.equal(innClockValue(innAddDays(d, 1)), "2026-08-18T20:17");
  assert.equal(innClockValue(innAddDays(d, -1)), "2026-08-16T20:17");
});

test("innAddDays rolls over month and year ends", () => {
  assert.equal(innDateValue(innAddDays(fromInnClock("2026-08-31"), 1)), "2026-09-01");
  assert.equal(innDateValue(innAddDays(fromInnClock("2026-12-31"), 1)), "2027-01-01");
  assert.equal(innDateValue(innAddDays(fromInnClock("2027-01-01"), -1)), "2026-12-31");
});

test("innTime normalises an out-of-range month, so 'last month' works in January", () => {
  // features/reports/components/report-range.tsx builds lastMonthStart as
  // innTime(year, month - 1, 1) — in January that is month 0.
  assert.equal(innDateValue(innTime(2026, 0, 1)), "2025-12-01");
  assert.equal(innDateValue(innTime(2026, 13, 1)), "2027-01-01");
});

test("the night window is 14:00 → next 12:00 at the inn", () => {
  // The house rule the dashboard, the reports and pricing all share.
  const day = fromInnClock("2026-08-17");
  assert.equal(innAtHour(day, 14).toISOString(), "2026-08-17T06:00:00.000Z");
  assert.equal(innAtHour(innAddDays(day, 1), 12).toISOString(), "2026-08-18T04:00:00.000Z");
});

test("innSameDay follows the inn's calendar across the UTC date line", () => {
  // 20:17 and 23:50 on the 17th in Manila are the 17th and the 17th — but
  // 12:17Z and 15:50Z, and getDate() on a UTC server agrees only by luck.
  assert.ok(innSameDay(fromInnClock("2026-08-17T20:17"), fromInnClock("2026-08-17T23:50")));
  assert.ok(!innSameDay(fromInnClock("2026-08-17T23:50"), fromInnClock("2026-08-18T00:10")));
});

test("innHour and innWeekday read the inn's clock", () => {
  const lateEvening = fromInnClock("2026-08-16T23:30"); // a Sunday at the inn
  assert.equal(innHour(lateEvening), 23);
  assert.equal(innWeekday(lateEvening), 0, "Sunday — 15:30Z, which is still Sunday in UTC too");
  const sundayNight = fromInnClock("2026-08-16T07:00"); // 23:00Z on SATURDAY
  assert.equal(innWeekday(sundayNight), 0, "still Sunday at the inn, though UTC says Saturday");
});

// ---- display ----------------------------------------------------------------

test("innFormatter prints the inn's hour whatever zone the viewer is in", () => {
  const at8pm = fromInnClock("2026-08-17T20:17");
  const out = innFormatter({ hour: "numeric", minute: "2-digit", hour12: false }).format(at8pm);
  assert.match(out, /20:17/);
});

test("innParts is 1-12 for months, so it reads like a human writes a date", () => {
  const p = innParts(fromInnClock("2026-08-17T20:17:45"));
  assert.deepEqual(p, { year: 2026, month: 8, day: 17, hour: 20, minute: 17, second: 45 });
});

// ---- the invariant that matters ---------------------------------------------

test("round-tripping any clock reading is lossless", () => {
  for (const s of [
    "2026-01-01T00:00",
    "2026-06-15T12:00",
    "2026-08-17T20:17",
    "2026-12-31T23:59",
  ]) {
    assert.equal(innClockValue(fromInnClock(s)), s, s);
  }
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
