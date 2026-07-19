// Pure unit test for the pricing mirror (quote). Run with:
//   node --experimental-strip-types supabase/tests/pricing.test.ts
// Must stay in lockstep with booking.fn_create_booking's SQL math.
import assert from "node:assert/strict";
import { quote, type RateTier, type Occupancy } from "../../src/features/bookings/pricing.ts";

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

const couple: Occupancy = { base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 };
const travellers: Occupancy = { base_occupancy: 4, max_occupancy: 6, excess_person_rate: 350 };

const block3: RateTier = { id: "a", label: "3 hrs", kind: "block", duration_hours: 3, price: 500 };
const overnightCouple: RateTier = { id: "b", label: "Overnight", kind: "overnight", duration_hours: null, price: 1250 };
const overnightTrav: RateTier = { id: "c", label: "Overnight", kind: "overnight", duration_hours: null, price: 1500 };

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
  const q = quote(overnightCouple, couple, 2, new Date("2026-08-01T14:00:00Z"), new Date("2026-08-03T12:00:00Z"));
  assert.ok("total" in q);
  assert.equal(q.nights, 2);
  assert.equal(q.roomTotal, 2500);
  assert.equal(q.total, 2500);
});

test("overnight charges excess per night", () => {
  // Travellers base 4; 6 guests = 2 excess; 2 nights → (1500 + 2×350) × 2.
  const q = quote(overnightTrav, travellers, 6, new Date("2026-08-01T14:00:00Z"), new Date("2026-08-03T12:00:00Z"));
  assert.ok("total" in q);
  assert.equal(q.excessHeads, 2);
  assert.equal(q.roomTotal, 3000);
  assert.equal(q.excessTotal, 1400);
  assert.equal(q.total, 4400);
});

test("guest count above max is an error", () => {
  const q = quote(overnightTrav, travellers, 7, new Date("2026-08-01T14:00:00Z"), new Date("2026-08-02T12:00:00Z"));
  assert.ok("error" in q);
  assert.match(q.error, /at most 6/i);
});

test("overnight without a check-out is an error", () => {
  const q = quote(overnightCouple, couple, 2, new Date("2026-08-01T14:00:00Z"));
  assert.ok("error" in q);
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
