// Pure unit tests for the /rooms occupancy derivation. Run with:
//   node --experimental-strip-types supabase/tests/occupancy.test.ts
// No DB — deriveOccupancy is pure. Relative imports (no @/ alias).
//
// Timestamps are built from LOCAL date parts via at(), because "today" is
// local to the inn; literal UTC strings would make these pass or fail
// depending on the machine's timezone.
import assert from "node:assert/strict";
import { deriveOccupancy, type OccupancyBooking } from "../../src/features/rooms/occupancy.ts";
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

// INN wall-clock (see src/lib/inn-time.ts), so the calendar these tests assert
// on is the inn's calendar whatever zone the test process runs in.
const NOW = innTime(2026, 8, 8, 15); // 8 Aug 2026, 3pm at the inn
function at(y: number, m: number, d: number, h = 12): string {
  return innTime(y, m, d, h).toISOString();
}

function bk(over: Partial<OccupancyBooking> = {}): OccupancyBooking {
  return {
    id: "b1",
    roomId: "r1",
    status: "confirmed",
    guestName: "Guest",
    checkIn: at(2026, 8, 8, 14),
    checkOut: at(2026, 8, 9, 12),
    ...over,
  };
}

console.log("room occupancy");

test("a room with nothing against it is free", () => {
  assert.deepEqual(deriveOccupancy("r1", [], NOW), { kind: "free" });
});

test("another room's booking never leaks into this one", () => {
  const r = deriveOccupancy("r1", [bk({ roomId: "r2", status: "checked_in" })], NOW);
  assert.equal(r.kind, "free");
});

test("a checked-in guest is in house", () => {
  const r = deriveOccupancy("r1", [bk({ status: "checked_in", guestName: "Ana" })], NOW);
  assert.equal(r.kind, "in_house");
  if (r.kind !== "in_house") return;
  assert.equal(r.guestName, "Ana");
  assert.equal(r.departingToday, false, "checking out tomorrow");
});

test("an in-house guest leaving today is flagged as departing", () => {
  const r = deriveOccupancy(
    "r1",
    [bk({ status: "checked_in", checkOut: at(2026, 8, 8, 12) })],
    NOW
  );
  assert.equal(r.kind, "in_house");
  if (r.kind !== "in_house") return;
  assert.equal(r.departingToday, true);
});

test("a confirmed booking checking in today is an arrival", () => {
  const r = deriveOccupancy("r1", [bk({ guestName: "Ben" })], NOW);
  assert.equal(r.kind, "arriving");
  if (r.kind !== "arriving") return;
  assert.equal(r.guestName, "Ben");
  assert.equal(r.awaitingDeposit, false);
});

test("a booking arriving on another day leaves the room free today", () => {
  const r = deriveOccupancy("r1", [bk({ checkIn: at(2026, 8, 10, 14) })], NOW);
  assert.equal(r.kind, "free");
});

test("a pending_verification arrival holds the room and says the deposit is unverified", () => {
  // It sits in the no_overlap exclusion constraint alongside confirmed, so
  // showing this room as free would invite a walk-in into a paid room.
  const r = deriveOccupancy("r1", [bk({ status: "pending_verification" })], NOW);
  assert.equal(r.kind, "arriving");
  if (r.kind !== "arriving") return;
  assert.equal(r.awaitingDeposit, true);
});

test("cancelled and no-show bookings hold nothing", () => {
  for (const status of ["cancelled", "no_show", "checked_out"]) {
    assert.equal(deriveOccupancy("r1", [bk({ status })], NOW).kind, "free", status);
  }
});

test("on a same-day turnover the departing guest wins until they leave", () => {
  // The room is occupied right up to checkout; telling the desk it's an
  // arrival would invite walking the next guest into an occupied room.
  const r = deriveOccupancy(
    "r1",
    [
      bk({ id: "out", status: "checked_in", guestName: "Ana", checkOut: at(2026, 8, 8, 12) }),
      bk({ id: "in", status: "confirmed", guestName: "Ben" }),
    ],
    NOW
  );
  assert.equal(r.kind, "in_house");
  if (r.kind !== "in_house") return;
  assert.equal(r.guestName, "Ana");
});

test("with two arrivals the earliest check-in is shown", () => {
  const r = deriveOccupancy(
    "r1",
    [
      bk({ id: "late", guestName: "Late", checkIn: at(2026, 8, 8, 20) }),
      bk({ id: "early", guestName: "Early", checkIn: at(2026, 8, 8, 14) }),
    ],
    NOW
  );
  assert.equal(r.kind, "arriving");
  if (r.kind !== "arriving") return;
  assert.equal(r.guestName, "Early");
});

test("an unparseable period is not mistaken for today", () => {
  const r = deriveOccupancy("r1", [bk({ checkIn: "" })], NOW);
  assert.equal(r.kind, "free");
});

if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
else console.log(`\nAll ${passed} tests passed.`);
