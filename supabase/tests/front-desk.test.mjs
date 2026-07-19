// Integration test for front-desk operations against the real local stack:
// payment-status sync trigger, fn_available_rooms (with exclusion), and the
// reassignment exclusion-constraint safety.
//
// Run: npm run db:start && node supabase/tests/front-desk.test.mjs
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

const W1 = ["2026-08-01T14:00:00Z", "2026-08-03T12:00:00Z"];

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("front-desk ops");
  await resetIdentity();
  const b = adminBooking();
  await b.from("payments").delete().not("id", "is", null);
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  await createUser("owner@test.local", "Olivia Owner");
  const admin = await clientAs("owner@test.local");
  await admin.rpc("fn_claim_invitation");

  // A type with two rooms, so reassignment has somewhere to go.
  const { data: dbl } = await b
    .from("room_types")
    .insert({ name: "Double", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  await b.from("rooms").insert([
    { room_type_id: dbl.id, label: "D1" },
    { room_type_id: dbl.id, label: "D2" },
  ]);
  const { data: dblTier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: dbl.id, label: "Overnight", kind: "overnight", price: 1000 })
    .select("id")
    .single();

  const { data: booking } = await admin.rpc("fn_create_booking", {
    p_guest_name: "Pay Guest",
    p_guest_phone: "",
    p_guest_email: "",
    p_room_type_id: dbl.id,
    p_rate_tier_id: dblTier.id,
    p_guest_count: 2,
    p_check_in: W1[0],
    p_check_out: W1[1],
    p_source: "walk_in",
    p_notes: "",
  });
  const bk = one(booking); // 2 nights × 1000 = 2000
  assert.equal(Number(bk.quoted_total), 2000);
  const assignedRoom = bk.room_id;

  await test("partial payment sets payment_status='partial'", async () => {
    const { error } = await b.from("payments").insert({ booking_id: bk.id, amount: 500, method: "cash" });
    assert.equal(error, null, error?.message);
    const { data } = await b.from("bookings").select("payment_status").eq("id", bk.id).single();
    assert.equal(data.payment_status, "partial");
  });

  await test("paying the remainder sets payment_status='paid'", async () => {
    await b.from("payments").insert({ booking_id: bk.id, amount: 1500, method: "gcash" });
    const { data } = await b.from("bookings").select("payment_status").eq("id", bk.id).single();
    assert.equal(data.payment_status, "paid");
  });

  await test("deleting a payment reverts the status", async () => {
    const { data: pays } = await b.from("payments").select("id").eq("booking_id", bk.id).limit(1);
    await b.from("payments").delete().eq("id", pays[0].id);
    const { data } = await b.from("bookings").select("payment_status").eq("id", bk.id).single();
    assert.notEqual(data.payment_status, "paid");
  });

  await test("fn_available_rooms excludes the booked room", async () => {
    const { data } = await admin.rpc("fn_available_rooms", {
      p_room_type_id: dbl.id,
      p_check_in: W1[0],
      p_check_out: W1[1],
      p_exclude_booking: null,
    });
    const labels = data.map((r) => r.id);
    assert.ok(!labels.includes(assignedRoom), "assigned room should not be free");
    assert.equal(data.length, 1, "one other room is free");
  });

  await test("fn_available_rooms includes the booking's own room when excluded", async () => {
    const { data } = await admin.rpc("fn_available_rooms", {
      p_room_type_id: dbl.id,
      p_check_in: W1[0],
      p_check_out: W1[1],
      p_exclude_booking: bk.id,
    });
    assert.equal(data.length, 2, "both rooms available when ignoring this booking");
  });

  await test("reassigning to a free room succeeds", async () => {
    const { data: free } = await admin.rpc("fn_available_rooms", {
      p_room_type_id: dbl.id,
      p_check_in: W1[0],
      p_check_out: W1[1],
      p_exclude_booking: bk.id,
    });
    const other = free.find((r) => r.id !== assignedRoom);
    const { error } = await b.from("bookings").update({ room_id: other.id }).eq("id", bk.id);
    assert.equal(error, null, error?.message);
    const { data } = await b.from("bookings").select("room_id").eq("id", bk.id).single();
    assert.equal(data.room_id, other.id);
  });

  await test("reassigning onto an overlapping booking is blocked by the exclusion constraint", async () => {
    // Second booking takes the other room for the same window.
    const { data: second } = await admin.rpc("fn_create_booking", {
      p_guest_name: "Second Guest",
      p_guest_phone: "",
      p_guest_email: "",
      p_room_type_id: dbl.id,
      p_rate_tier_id: dblTier.id,
      p_guest_count: 2,
      p_check_in: W1[0],
      p_check_out: W1[1],
      p_source: "walk_in",
      p_notes: "",
    });
    const secondRoom = one(second).room_id;
    // Try to move the first booking onto the second's room → must fail.
    const { error } = await b.from("bookings").update({ room_id: secondRoom }).eq("id", bk.id);
    assert.ok(error, "expected an exclusion-constraint violation");
  });

  await b.from("payments").delete().not("id", "is", null);
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
