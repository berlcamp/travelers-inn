// Integration test for the booking engine against the real local stack:
// the exclusion-constraint double-booking guarantee, authoritative pricing,
// availability counts, cancellation freeing a room, and hourly rules.
//
// Run: npm run db:start && node supabase/tests/bookings.test.mjs
import assert from "node:assert/strict";
import { adminBooking, createUser, clientAs, resetIdentity } from "./_helpers.mjs";

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Booking windows (UTC).
const W1 = ["2026-08-01T14:00:00Z", "2026-08-03T12:00:00Z"]; // 2 nights
const W3 = ["2026-08-05T14:00:00Z", "2026-08-06T12:00:00Z"]; // 1 night
const H1 = ["2026-08-10T10:00:00Z", "2026-08-10T13:00:00Z"]; // 3 hours

function book(client, opts) {
  return client.rpc("fn_create_booking", {
    p_guest_name: opts.name ?? "Test Guest",
    p_guest_phone: opts.phone ?? null,
    p_guest_email: opts.email ?? null,
    p_room_type_id: opts.typeId,
    p_stay_type: opts.stay ?? "nightly",
    p_check_in: opts.window[0],
    p_check_out: opts.window[1],
    p_source: opts.source ?? "walk_in",
    p_notes: opts.notes ?? null,
  });
}

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("bookings engine");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  await createUser("owner@test.local", "Olivia Owner");
  const admin = await clientAs("owner@test.local");
  await admin.rpc("fn_claim_invitation");

  // Type with a SINGLE room, so an overlap deterministically has no free room.
  const { data: solo } = await b
    .from("room_types")
    .insert({ name: "Solo", capacity: 1, nightly_rate: 1000, hourly_rate: 200 })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: solo.id, label: "S1" });

  // Type with no hourly rate.
  const { data: noHourly } = await b
    .from("room_types")
    .insert({ name: "NoHourly", capacity: 2, nightly_rate: 1500, hourly_rate: null })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: noHourly.id, label: "N1" });

  let firstBookingId;

  await test("nightly booking prices by nights and assigns a room", async () => {
    const { data, error } = await book(admin, { typeId: solo.id, window: W1 });
    assert.equal(error, null, error?.message);
    const row = one(data);
    assert.equal(Number(row.quoted_total), 2000, "2 nights × 1000");
    assert.ok(row.room_id, "a room should be assigned");
    assert.ok(row.reference_code?.startsWith("TI-"), "reference code present");
    firstBookingId = row.id;
  });

  await test("overlapping booking on the only room is rejected (no_availability)", async () => {
    const { error } = await book(admin, { typeId: solo.id, window: W1 });
    assert.ok(error, "expected an error");
    assert.match(error.message, /No rooms/i);
  });

  await test("non-overlapping booking succeeds", async () => {
    const { data, error } = await book(admin, { typeId: solo.id, window: W3 });
    assert.equal(error, null, error?.message);
    assert.equal(Number(one(data).quoted_total), 1000, "1 night × 1000");
  });

  await test("fn_count_available reflects active bookings", async () => {
    const { data: busy } = await admin.rpc("fn_count_available", {
      p_room_type_id: solo.id,
      p_check_in: W1[0],
      p_check_out: W1[1],
    });
    assert.equal(busy, 0, "Solo is fully booked in W1");
    const { data: free } = await admin.rpc("fn_count_available", {
      p_room_type_id: solo.id,
      p_check_in: "2026-09-01T14:00:00Z",
      p_check_out: "2026-09-02T12:00:00Z",
    });
    assert.equal(free, 1, "Solo is free in September");
  });

  await test("cancelling a booking frees the room for that window", async () => {
    const { error: cancelErr } = await b
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", firstBookingId);
    assert.equal(cancelErr, null, cancelErr?.message);
    const { data, error } = await book(admin, { typeId: solo.id, window: W1 });
    assert.equal(error, null, error?.message);
    assert.ok(one(data).id, "W1 books again after cancellation");
  });

  await test("hourly booking prices by hours", async () => {
    const { data, error } = await book(admin, { typeId: solo.id, window: H1, stay: "hourly" });
    assert.equal(error, null, error?.message);
    assert.equal(Number(one(data).quoted_total), 600, "3 hours × 200");
  });

  await test("hourly booking on a type without an hourly rate is rejected", async () => {
    const { error } = await book(admin, { typeId: noHourly.id, window: H1, stay: "hourly" });
    assert.ok(error, "expected an error");
    assert.match(error.message, /hourly rate/i);
  });

  await test("check-out before check-in is rejected", async () => {
    const { error } = await book(admin, {
      typeId: solo.id,
      window: ["2026-08-20T12:00:00Z", "2026-08-20T10:00:00Z"],
    });
    assert.ok(error, "expected an error");
    assert.match(error.message, /after check-in/i);
  });

  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await resetIdentity();

  if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
  else console.log(`\nAll ${passed} tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
