// Pure unit test for the dashboard metrics. Run with:
//   node --experimental-strip-types supabase/tests/reports.test.ts
// No DB — computeDashboard is pure. Relative import (no @/ alias).
import assert from "node:assert/strict";
import { computeDashboard, type RptBooking, type RptPayment } from "../../src/features/reports/reports.ts";

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

// Fixed "now" so day math is deterministic.
const now = new Date("2026-08-15T10:00:00");
function at(day: number, h: number, m = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function booking(over: Partial<RptBooking>): RptBooking {
  return {
    id: over.id ?? crypto.randomUUID(),
    roomId: over.roomId ?? "r1",
    status: over.status ?? "confirmed",
    checkIn: over.checkIn ?? at(0, 14),
    checkOut: over.checkOut ?? at(1, 12),
    quotedTotal: over.quotedTotal ?? 1000,
    guestName: over.guestName ?? "Guest",
    roomLabel: over.roomLabel ?? "101",
    roomTypeName: over.roomTypeName ?? "Standard",
  };
}

console.log("dashboard metrics");

const roomIds = ["r1", "r2", "r3", "r4"];

const bookings: RptBooking[] = [
  // Arrives today (confirmed), room r1.
  booking({ id: "b1", roomId: "r1", status: "confirmed", checkIn: at(0, 14), checkOut: at(2, 12), quotedTotal: 2000 }),
  // Also arrives today, room r2.
  booking({ id: "b2", roomId: "r2", status: "confirmed", checkIn: at(0, 14), checkOut: at(1, 12), quotedTotal: 1000 }),
  // Checked in, departs today, room r3.
  booking({ id: "b3", roomId: "r3", status: "checked_in", checkIn: at(-1, 14), checkOut: at(0, 12), quotedTotal: 1500 }),
  // Cancelled — ignored.
  booking({ id: "b4", roomId: "r4", status: "cancelled", checkIn: at(0, 14), checkOut: at(1, 12) }),
];

const payments: RptPayment[] = [
  { bookingId: "b1", amount: 500, createdAt: at(0, 9) }, // today
  { bookingId: "b3", amount: 1500, createdAt: at(-2, 9) }, // 2 days ago
];

const d = computeDashboard({ now, roomIds, bookings, payments });

test("arrivals today counts confirmed check-ins today", () => {
  assert.equal(d.arrivalsToday.length, 2);
});

test("departures today counts checked_in check-outs today", () => {
  assert.equal(d.departuresToday.length, 1);
  assert.equal(d.departuresToday[0].id, "b3");
});

test("in-house counts checked_in bookings", () => {
  assert.equal(d.inHouse, 1);
});

test("occupancy tonight = rooms with active booking overlapping tonight", () => {
  // Tonight window [today 14:00, tomorrow 12:00). b1 (r1) and b2 (r2) overlap;
  // b3 departs today 12:00 (before 14:00) so not tonight; b4 cancelled.
  assert.equal(d.roomsOccupiedTonight, 2);
  assert.equal(d.roomsTotal, 4);
  assert.equal(d.occupancyPct, 50);
});

test("revenue today sums today's payments", () => {
  assert.equal(d.revenueToday, 500);
});

test("outstanding sums unpaid balance of active bookings", () => {
  // b1: 2000-500=1500; b2: 1000-0=1000; b3: 1500-1500=0 → 2500.
  assert.equal(d.outstanding, 2500);
});

test("7-day series have 7 points each", () => {
  assert.equal(d.revenue7d.length, 7);
  assert.equal(d.occupancy7d.length, 7);
  // Last point is today; revenue today = 500.
  assert.equal(d.revenue7d[6].value, 500);
  // Two days ago had a 1500 payment.
  assert.equal(d.revenue7d[4].value, 1500);
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
