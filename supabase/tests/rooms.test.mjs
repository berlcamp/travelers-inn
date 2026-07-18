// Integration test for room_types + rooms at the DB layer (PostgREST + RLS +
// constraints) against the real local stack.
//
// Run: npm run db:start && node supabase/tests/rooms.test.mjs
import assert from "node:assert/strict";
import {
  adminBooking,
  createUser,
  clientAs,
  resetIdentity,
  SUPABASE_URL,
  ANON_KEY,
} from "./_helpers.mjs";
import { createClient } from "@supabase/supabase-js";

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

// A booking-schema client authenticated as `email`.
async function bookingClientAs(email) {
  return clientAs(email);
}

async function main() {
  console.log("room_types + rooms");
  await resetIdentity();
  const svc = adminBooking();
  // Clean slate for inventory too. Bookings reference rooms (FK on delete
  // restrict), so they must go first or the room delete silently no-ops.
  await svc.from("bookings").delete().not("id", "is", null);
  await svc.from("rooms").delete().not("id", "is", null);
  await svc.from("room_types").delete().not("id", "is", null);

  // Bootstrap an admin (first user) and an invited front_desk.
  await createUser("owner@test.local", "Olivia Owner");
  const admin = await bookingClientAs("owner@test.local");
  await admin.rpc("fn_claim_invitation");

  await svc.from("invitations").insert({ email: "desk@test.local", role: "front_desk" });
  await createUser("desk@test.local", "Dana Desk");
  const desk = await bookingClientAs("desk@test.local");
  await desk.rpc("fn_claim_invitation");

  let typeId;

  await test("admin creates a room type with nightly + hourly rate", async () => {
    const { data, error } = await admin
      .from("room_types")
      .insert({ name: "Deluxe Double", capacity: 2, nightly_rate: 1800, hourly_rate: 250 })
      .select("id, nightly_rate, hourly_rate")
      .single();
    assert.equal(error, null, error?.message);
    assert.equal(Number(data.nightly_rate), 1800);
    assert.equal(Number(data.hourly_rate), 250);
    typeId = data.id;
  });

  await test("duplicate room type name (case-insensitive) is rejected", async () => {
    const { error } = await admin
      .from("room_types")
      .insert({ name: "deluxe double", capacity: 2, nightly_rate: 1500 });
    assert.ok(error, "expected a unique-violation error");
  });

  await test("negative nightly_rate is rejected by the check constraint", async () => {
    const { error } = await admin
      .from("room_types")
      .insert({ name: "Bad Rate", capacity: 2, nightly_rate: -1 });
    assert.ok(error, "expected a check-constraint error");
  });

  await test("front_desk cannot create a room type (RLS denies)", async () => {
    const { data, error } = await desk
      .from("room_types")
      .insert({ name: "Sneaky Suite", capacity: 4, nightly_rate: 3000 })
      .select("id");
    // RLS denies the insert: either an error or zero rows returned.
    assert.ok(error || !data || data.length === 0, "front_desk insert should be blocked");
    const { data: check } = await svc
      .from("room_types")
      .select("id")
      .eq("name", "Sneaky Suite");
    assert.equal(check.length, 0, "no room type should have been created");
  });

  let roomId;
  await test("admin creates a room of the type", async () => {
    const { data, error } = await admin
      .from("rooms")
      .insert({ room_type_id: typeId, label: "101" })
      .select("id, status")
      .single();
    assert.equal(error, null, error?.message);
    assert.equal(data.status, "vacant");
    roomId = data.id;
  });

  await test("front_desk can update a room's status", async () => {
    const { error } = await desk.from("rooms").update({ status: "cleaning" }).eq("id", roomId);
    assert.equal(error, null, error?.message);
    const { data } = await svc.from("rooms").select("status").eq("id", roomId).single();
    assert.equal(data.status, "cleaning");
  });

  await test("anonymous visitor can read room types (portal inventory)", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { db: { schema: "booking" } });
    const { data, error } = await anon.from("room_types").select("id, name, nightly_rate");
    assert.equal(error, null, error?.message);
    assert.ok(data.length >= 1, "anon should read at least the created type");
  });

  // Cleanup (bookings first — FK to rooms).
  await svc.from("bookings").delete().not("id", "is", null);
  await svc.from("rooms").delete().not("id", "is", null);
  await svc.from("room_types").delete().not("id", "is", null);
  await resetIdentity();

  if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
  else console.log(`\nAll ${passed} tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
