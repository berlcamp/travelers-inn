// Integration test for the public portal booking path against the real local
// stack: a portal booking uses the shared engine, records source='portal', and
// auto-confirms; a fully-booked type is rejected.
//
// Run: npm run db:start && node supabase/tests/portal.test.mjs
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

const W = ["2026-09-10T14:00:00Z", "2026-09-12T12:00:00Z"]; // 2 nights

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("public portal");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  // Single-room type so we can exhaust it.
  const { data: solo } = await b
    .from("room_types")
    .insert({ name: "Portal Solo", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: solo.id, label: "P1" });
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: solo.id, label: "Overnight", kind: "overnight", price: 1200 })
    .select("id")
    .single();

  await test("a portal booking auto-confirms with source='portal'", async () => {
    const { data, error } = await b.rpc("fn_create_booking", {
      p_guest_name: "Web Guest",
      p_guest_phone: "09170000000",
      p_guest_email: "",
      p_room_type_id: solo.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W[0],
      p_check_out: W[1],
      p_source: "portal",
      p_notes: "",
    });
    assert.equal(error, null, error?.message);
    const row = one(data);
    assert.equal(row.source, "portal");
    assert.equal(row.status, "confirmed");
    assert.equal(Number(row.quoted_total), 2400, "2 nights × 1200");
  });

  await test("a second overlapping portal booking is rejected (no availability)", async () => {
    const { error } = await b.rpc("fn_create_booking", {
      p_guest_name: "Late Guest",
      p_guest_phone: "09171111111",
      p_guest_email: "",
      p_room_type_id: solo.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W[0],
      p_check_out: W[1],
      p_source: "portal",
      p_notes: "",
    });
    assert.ok(error, "expected a no-availability error");
    assert.match(error.message, /No rooms/i);
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
