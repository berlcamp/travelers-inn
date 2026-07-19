// Integration test for the booking engine against the real local stack:
// the exclusion-constraint double-booking guarantee, tiered + occupancy-based
// pricing, block check-out derivation, availability counts, and cancellation.
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
const BLK = ["2026-08-10T10:00:00Z", "2026-08-10T10:00:00Z"]; // block: out derived

function book(client, opts) {
  return client.rpc("fn_create_booking", {
    p_guest_name: opts.name ?? "Test Guest",
    p_guest_phone: opts.phone ?? null,
    p_guest_email: opts.email ?? null,
    p_room_type_id: opts.typeId,
    p_rate_tier_id: opts.tierId,
    p_guest_count: opts.guests ?? 1,
    p_check_in: opts.window[0],
    p_check_out: opts.window[1],
    p_source: opts.source ?? "walk_in",
    p_notes: opts.notes ?? null,
  });
}

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

// Create a room type + its tiers; returns { typeId, tiers: { label: id } }.
async function createType(b, { name, base, max, excess, rooms, tiers }) {
  const { data: type } = await b
    .from("room_types")
    .insert({ name, base_occupancy: base, max_occupancy: max, excess_person_rate: excess })
    .select("id")
    .single();
  for (let i = 0; i < rooms; i += 1) {
    await b.from("rooms").insert({ room_type_id: type.id, label: `${name}-${i + 1}` });
  }
  const tierIds = {};
  for (const [i, t] of tiers.entries()) {
    const { data: tier } = await b
      .from("rate_tiers")
      .insert({
        room_type_id: type.id,
        label: t.label,
        kind: t.kind,
        duration_hours: t.duration_hours ?? null,
        price: t.price,
        sort_order: i,
      })
      .select("id")
      .single();
    tierIds[t.label] = tier.id;
  }
  return { typeId: type.id, tiers: tierIds };
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

  // Couple: single room; day-use blocks + overnight; no excess (base = max).
  const couple = await createType(b, {
    name: "Couple",
    base: 2,
    max: 2,
    excess: 0,
    rooms: 1,
    tiers: [
      { label: "3 hrs", kind: "block", duration_hours: 3, price: 500 },
      { label: "Overnight", kind: "overnight", price: 1250 },
    ],
  });

  // Travellers: overnight only; base 4, max 6, ₱350/excess head/night.
  const travellers = await createType(b, {
    name: "Travellers",
    base: 4,
    max: 6,
    excess: 350,
    rooms: 1,
    tiers: [{ label: "Overnight", kind: "overnight", price: 1500 }],
  });

  let firstBookingId;

  await test("overnight prices by nights and assigns a room", async () => {
    const { data, error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["Overnight"],
      guests: 2,
      window: W1,
    });
    assert.equal(error, null, error?.message);
    const row = one(data);
    assert.equal(Number(row.quoted_total), 2500, "2 nights × 1250");
    assert.ok(row.room_id, "a room should be assigned");
    assert.ok(row.reference_code?.startsWith("TI-"), "reference code present");
    firstBookingId = row.id;
  });

  await test("overlapping booking on the only room is rejected", async () => {
    const { error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["Overnight"],
      guests: 2,
      window: W1,
    });
    assert.ok(error, "expected an error");
    assert.match(error.message, /No rooms/i);
  });

  await test("non-overlapping booking succeeds", async () => {
    const { data, error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["Overnight"],
      guests: 2,
      window: W3,
    });
    assert.equal(error, null, error?.message);
    assert.equal(Number(one(data).quoted_total), 1250, "1 night × 1250");
  });

  await test("fn_count_available reflects active bookings", async () => {
    const { data: busy } = await admin.rpc("fn_count_available", {
      p_room_type_id: couple.typeId,
      p_check_in: W1[0],
      p_check_out: W1[1],
    });
    assert.equal(busy, 0, "Couple is fully booked in W1");
    const { data: free } = await admin.rpc("fn_count_available", {
      p_room_type_id: couple.typeId,
      p_check_in: "2026-09-01T14:00:00Z",
      p_check_out: "2026-09-02T12:00:00Z",
    });
    assert.equal(free, 1, "Couple is free in September");
  });

  await test("cancelling a booking frees the room for that window", async () => {
    const { error: cancelErr } = await b
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", firstBookingId);
    assert.equal(cancelErr, null, cancelErr?.message);
    const { data, error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["Overnight"],
      guests: 2,
      window: W1,
    });
    assert.equal(error, null, error?.message);
    assert.ok(one(data).id, "W1 books again after cancellation");
  });

  await test("block tier prices flat and derives check-out from duration", async () => {
    const { data, error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["3 hrs"],
      guests: 2,
      window: BLK,
    });
    assert.equal(error, null, error?.message);
    const row = one(data);
    assert.equal(Number(row.quoted_total), 500, "flat block price");
    // check-in 10:00 + 3h → check-out 13:00, regardless of the passed value.
    assert.match(row.period, /13:00/, "check-out derived to +3h");
  });

  await test("overnight excess is charged per night", async () => {
    // Travellers base 4; 6 guests = 2 excess; 2 nights → (1500 + 2×350) × 2.
    const { data, error } = await book(admin, {
      typeId: travellers.typeId,
      tierId: travellers.tiers["Overnight"],
      guests: 6,
      window: W1,
    });
    assert.equal(error, null, error?.message);
    assert.equal(Number(one(data).quoted_total), 4400, "(1500 + 700) × 2 nights");
  });

  await test("guest count over max_occupancy is rejected", async () => {
    const { error } = await book(admin, {
      typeId: travellers.typeId,
      tierId: travellers.tiers["Overnight"],
      guests: 7,
      window: W3,
    });
    assert.ok(error, "expected an error");
    assert.match(error.message, /at most 6 guests/i);
  });

  await test("a tier from another room type is rejected", async () => {
    const { error } = await book(admin, {
      typeId: couple.typeId,
      tierId: travellers.tiers["Overnight"],
      guests: 2,
      window: W3,
    });
    assert.ok(error, "expected an error");
    assert.match(error.message, /rate is not available/i);
  });

  await test("overnight check-out before check-in is rejected", async () => {
    const { error } = await book(admin, {
      typeId: couple.typeId,
      tierId: couple.tiers["Overnight"],
      guests: 2,
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
