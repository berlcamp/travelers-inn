// Pure unit tests for the actual-check-out stamp. Run with:
//   node --experimental-strip-types supabase/tests/stay-window.test.ts
// No DB — actualStayWindow is pure. Relative imports (no @/ alias).
import assert from "node:assert/strict";
import { actualStayWindow } from "../../src/features/bookings/stay-window.ts";

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

// Local wall-clock, like every other date in this app: the inn is one site and
// the desk types local times into datetime-local inputs.
function at(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

console.log("actual check-out window");

test("the guest who leaves late gets the real time, not the booked one", () => {
  // Booked as a 12-hour block: 17:00 → 05:00 next day. They left at 07:30.
  const w = actualStayWindow(at(2026, 8, 17, 17).toISOString(), at(2026, 8, 18, 7, 30));
  assert.ok(w);
  assert.equal(w.checkOut, at(2026, 8, 18, 7, 30).toISOString());
});

test("the window keeps the original check-in and is half-open", () => {
  const inAt = at(2026, 8, 17, 17);
  const w = actualStayWindow(inAt.toISOString(), at(2026, 8, 18, 5));
  assert.ok(w);
  assert.equal(
    w.period,
    `["${inAt.toISOString()}","${at(2026, 8, 18, 5).toISOString()}")`,
    "check-in is untouched; the room is free again the instant they walk out"
  );
});

test("leaving early shortens the stay", () => {
  // Booked to noon, walked out at 09:15.
  const w = actualStayWindow(at(2026, 8, 17, 14).toISOString(), at(2026, 8, 18, 9, 15));
  assert.ok(w);
  assert.equal(w.checkOut, at(2026, 8, 18, 9, 15).toISOString());
});

test("a check-out at or before check-in is refused, not stamped", () => {
  // Checked in early at 11:00 for a 13:00 booking, then left at 12:00. The
  // booked window has to stand: the alternative is an empty range that
  // bookings_period_valid rejects, failing the check-out entirely.
  const inAt = at(2026, 8, 17, 13).toISOString();
  assert.equal(actualStayWindow(inAt, at(2026, 8, 17, 12)), null);
  assert.equal(actualStayWindow(inAt, at(2026, 8, 17, 13)), null, "equal is empty too");
});

test("an unreadable check-in leaves the booked window alone", () => {
  assert.equal(actualStayWindow("", at(2026, 8, 18, 5)), null);
  assert.equal(actualStayWindow("not a date", at(2026, 8, 18, 5)), null);
  assert.equal(actualStayWindow(at(2026, 8, 17, 17).toISOString(), new Date(NaN)), null);
});

if (process.exitCode) {
  console.error(`\n${passed} passed, with failures.`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
