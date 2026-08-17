// Pure unit test for the pricing mirror (quote). Run with:
//   node --experimental-strip-types supabase/tests/pricing.test.ts
// Must stay in lockstep with booking.fn_create_booking's SQL math.
import assert from "node:assert/strict";
import {
  quote,
  checkOutAtNoon,
  checkOutValue,
  type RateTier,
  type Occupancy,
} from "../../src/features/bookings/pricing.ts";
import { innTime } from "../../src/lib/inn-time.ts";

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

// Overnight windows are built from INN wall-clock parts: the noon check-out is
// a wall-clock rule ("out by 12 noon"), so a UTC literal would test a different
// hour, and `new Date(y, m-1, d, h)` would test a different INSTANT on every
// machine — which is exactly the production bug this guards (see lib/inn-time.ts).
// innTime() pins it, so these assertions hold under TZ=UTC and TZ=Asia/Manila alike.
function at(y: number, m: number, d: number, h: number, min = 0): Date {
  return innTime(y, m, d, h, min);
}

const couple: Occupancy = { base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 };
const travellers: Occupancy = { base_occupancy: 4, max_occupancy: 6, excess_person_rate: 350 };

const block3: RateTier = { id: "a", label: "3 hrs", kind: "block", duration_hours: 3, price: 500 };
const overnightCouple: RateTier = {
  id: "b",
  label: "Overnight",
  kind: "overnight",
  duration_hours: null,
  price: 1250,
};
const overnightTrav: RateTier = {
  id: "c",
  label: "Overnight",
  kind: "overnight",
  duration_hours: null,
  price: 1500,
};

console.log("pricing quote()");

test("block prices flat and derives check-out from duration", () => {
  const checkIn = new Date("2026-08-10T10:00:00Z");
  const q = quote(block3, couple, 2, checkIn);
  assert.ok("total" in q);
  assert.equal(q.total, 500);
  assert.equal(q.nights, null);
  assert.equal(q.checkOut.getTime(), new Date("2026-08-10T13:00:00Z").getTime());
});

test("overnight prices per night", () => {
  const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14), at(2026, 8, 3, 12));
  assert.ok("total" in q);
  assert.equal(q.nights, 2);
  assert.equal(q.roomTotal, 2500);
  assert.equal(q.total, 2500);
});

test("overnight charges excess per night", () => {
  // Travellers base 4; 6 guests = 2 excess; 2 nights → (1500 + 2×350) × 2.
  const q = quote(overnightTrav, travellers, 6, at(2026, 8, 1, 14), at(2026, 8, 3, 12));
  assert.ok("total" in q);
  assert.equal(q.excessHeads, 2);
  assert.equal(q.roomTotal, 3000);
  assert.equal(q.excessTotal, 1400);
  assert.equal(q.total, 4400);
});

test("guest count above max is an error", () => {
  const q = quote(overnightTrav, travellers, 7, at(2026, 8, 1, 14), at(2026, 8, 2, 12));
  assert.ok("error" in q);
  assert.match(q.error, /at most 6/i);
});

test("overnight without a check-out is an error", () => {
  const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14));
  assert.ok("error" in q);
});

// ---- the noon rule ----------------------------------------------------------
// An overnight guest is due out at 12:00 on the check-out DATE. The desk picks
// the date; the hour is the house rule, so it is snapped before it can reach
// either the price or the room's window. Leaving earlier is recorded at
// check-out instead (features/bookings/stay-window.ts).

test("an overnight check-out is snapped to noon whatever hour was typed", () => {
  for (const typed of [at(2026, 8, 2, 8), at(2026, 8, 2, 12), at(2026, 8, 2, 19, 30)]) {
    const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14), typed);
    assert.ok("total" in q);
    assert.equal(q.checkOut.getTime(), at(2026, 8, 2, 12).getTime());
    assert.equal(q.nights, 1, "and it stays one night, at one night's price");
    assert.equal(q.total, 1250);
  }
});

test("a late hour no longer buys a second night by accident", () => {
  // 14:00 → 15:00 the next day is 25 hours: ceil() would have charged 2.
  const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14), at(2026, 8, 2, 15));
  assert.ok("total" in q);
  assert.equal(q.nights, 1);
  assert.equal(q.total, 1250);
});

test("a two-night stay is still two nights", () => {
  const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14), at(2026, 8, 3, 9));
  assert.ok("total" in q);
  assert.equal(q.checkOut.getTime(), at(2026, 8, 3, 12).getTime());
  assert.equal(q.nights, 2);
});

test("a check-out date on the arrival day cannot be booked", () => {
  // Noon that day is before a 14:00 arrival — an empty stay, not a cheap one.
  const q = quote(overnightCouple, couple, 2, at(2026, 8, 1, 14), at(2026, 8, 1, 23));
  assert.ok("error" in q);
  assert.match(q.error, /after check-in/i);
});

test("checkOutAtNoon keeps the date and drops the time", () => {
  assert.equal(checkOutAtNoon(at(2026, 8, 18, 5, 30)).getTime(), at(2026, 8, 18, 12).getTime());
});

test("checkOutValue takes either form the forms speak", () => {
  assert.equal(checkOutValue("2026-08-18"), "2026-08-18T12:00", "a date input");
  assert.equal(checkOutValue("2026-08-18T05:30"), "2026-08-18T12:00", "a datetime-local one");
  assert.equal(checkOutValue(""), "", "and leaves an empty field alone");
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
