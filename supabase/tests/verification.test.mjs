// Integration tests for the deposit-verification lifecycle against the real
// local stack. The load-bearing assertion is that a pending_verification
// booking HOLDS its room — a guest who has paid must never lose it.
//
// Run: npm run db:start && node supabase/tests/verification.test.mjs
import assert from "node:assert/strict";
import { adminBooking, resetIdentity } from "./_helpers.mjs";

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

const W = ["2026-10-10T14:00:00Z", "2026-10-12T12:00:00Z"]; // 2 nights

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("deposit verification");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  // One room only, so a held room is provably unavailable to the next booker.
  const { data: type } = await b
    .from("room_types")
    .insert({ name: "Verify Solo", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: type.id, label: "V1" });
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1000 })
    .select("id")
    .single();

  const makeBooking = (status, name) =>
    b.rpc("fn_create_booking", {
      p_guest_name: name,
      p_guest_phone: "09170000000",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W[0],
      p_check_out: W[1],
      p_source: "portal",
      p_notes: "",
      p_status: status,
    });

  let pendingId = null;

  await test("a portal booking can be created as pending_verification", async () => {
    const { data, error } = await makeBooking("pending_verification", "Pending Guest");
    assert.equal(error, null);
    const row = one(data);
    assert.equal(row.status, "pending_verification");
    assert.equal(row.source, "portal");
    assert.equal(Number(row.quoted_total), 2000); // 1000 × 2 nights
    pendingId = row.id;
  });

  await test("a pending booking HOLDS the room against an overlapping booking", async () => {
    const { data, error } = await makeBooking("confirmed", "Late Guest");
    assert.equal(data, null);
    assert.match(error.message, /No rooms of that type are free/);
  });

  await test("fn_count_available excludes a room held by a pending booking", async () => {
    const { data } = await b.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: W[0],
      p_check_out: W[1],
    });
    assert.equal(data, 0);
  });

  await test("confirming records a payment and derives partial payment status", async () => {
    await b.from("bookings").update({ status: "confirmed" }).eq("id", pendingId);
    await b.from("payments").insert({ booking_id: pendingId, amount: 1000, method: "gcash" });
    const { data } = await b
      .from("bookings")
      .select("status, payment_status")
      .eq("id", pendingId)
      .single();
    assert.equal(data.status, "confirmed");
    assert.equal(data.payment_status, "partial"); // 1000 of 2000
  });

  await test("rejecting a pending booking frees the room", async () => {
    // Fresh pending booking on a non-overlapping window, then cancel it.
    const W2 = ["2026-11-01T14:00:00Z", "2026-11-02T12:00:00Z"];
    const { data: created } = await b.rpc("fn_create_booking", {
      p_guest_name: "Reject Me",
      p_guest_phone: "09170000001",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W2[0],
      p_check_out: W2[1],
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    const rejectId = one(created).id;

    // Self-contained: prove the room was actually held before we free it,
    // otherwise the post-cancellation count of 1 would be true regardless.
    const { data: heldCount } = await b.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: W2[0],
      p_check_out: W2[1],
    });
    assert.equal(heldCount, 0, "the room should be held while the booking is pending");

    await b.from("bookings").update({ status: "cancelled" }).eq("id", rejectId);

    const { data: count } = await b.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: W2[0],
      p_check_out: W2[1],
    });
    assert.equal(count, 1, "the room should be bookable again after rejection");
  });

  await test("p_status defaults to confirmed so walk-ins are unaffected", async () => {
    const W3 = ["2026-12-01T14:00:00Z", "2026-12-02T12:00:00Z"];
    const { data, error } = await b.rpc("fn_create_booking", {
      p_guest_name: "Walk In",
      p_guest_phone: "09170000002",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W3[0],
      p_check_out: W3[1],
      p_source: "walk_in",
      p_notes: "",
      // p_status deliberately omitted
    });
    assert.equal(error, null);
    assert.equal(one(data).status, "confirmed");
  });

  await test("a proof row attaches to a booking and cascades on delete", async () => {
    const { error } = await b.from("booking_proofs").insert({
      booking_id: pendingId,
      method: "gcash",
      reference_no: "ABC123",
      declared_amount: 1000,
      storage_path: "test/proof.jpg",
    });
    assert.equal(error, null);

    await b.from("bookings").delete().eq("id", pendingId);
    const { data: orphans } = await b
      .from("booking_proofs")
      .select("id")
      .eq("booking_id", pendingId);
    assert.equal(orphans.length, 0);
  });

  await test("the no_overlap constraint itself rejects a direct overlapping insert, bypassing fn_create_booking's pre-check", async () => {
    // Every assertion above goes through fn_create_booking, whose own
    // application-level NOT EXISTS pre-check would already stop an
    // overlapping insert before the raw GiST exclusion constraint is ever
    // reached. Insert straight into booking.bookings to prove the widened
    // constraint (WHERE status in (...'pending_verification'...)) enforces
    // the guarantee on its own, independent of that pre-check.
    const W4 = ["2027-01-10T14:00:00Z", "2027-01-12T12:00:00Z"];
    const { data: created, error: createErr } = await b.rpc("fn_create_booking", {
      p_guest_name: "Constraint Guard",
      p_guest_phone: "09170000003",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W4[0],
      p_check_out: W4[1],
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    assert.equal(createErr, null);
    const holder = one(created);

    const { error } = await b.from("bookings").insert({
      guest_name: "Direct Insert Bypass",
      room_type_id: type.id,
      room_id: holder.room_id,
      rate_tier_id: tier.id,
      guest_count: 2,
      period: `[${W4[0]},${W4[1]})`,
      status: "confirmed",
      source: "staff",
      quoted_total: 1000,
    });

    assert.ok(error, "expected the exclusion constraint to reject a direct overlapping insert");
    assert.equal(
      error.code,
      "23P01",
      `expected SQLSTATE 23P01 (exclusion_violation) from constraint "no_overlap", got ${error.code}: ${error.message}`,
    );
  });

  await test("fn_available_rooms returns no rows for a window held by a pending booking, and the room again once cancelled", async () => {
    const W5 = ["2027-02-10T14:00:00Z", "2027-02-12T12:00:00Z"];
    const { data: created, error: createErr } = await b.rpc("fn_create_booking", {
      p_guest_name: "Available Rooms Guard",
      p_guest_phone: "09170000004",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W5[0],
      p_check_out: W5[1],
      p_source: "portal",
      p_notes: "",
      p_status: "pending_verification",
    });
    assert.equal(createErr, null);
    const heldId = one(created).id;

    const { data: heldRooms, error: heldErr } = await b.rpc("fn_available_rooms", {
      p_room_type_id: type.id,
      p_check_in: W5[0],
      p_check_out: W5[1],
    });
    assert.equal(heldErr, null);
    assert.equal(heldRooms.length, 0, "the sole room should be held while pending verification");

    await b.from("bookings").update({ status: "cancelled" }).eq("id", heldId);

    const { data: freedRooms } = await b.rpc("fn_available_rooms", {
      p_room_type_id: type.id,
      p_check_in: W5[0],
      p_check_out: W5[1],
    });
    assert.equal(freedRooms.length, 1, "the room should reappear once the pending booking is cancelled");
  });

  console.log(`\n${passed} passed`);
}

main();
