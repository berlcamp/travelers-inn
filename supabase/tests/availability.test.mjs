// Integration test for the staff availability lookup (/availability) against
// the real local stack. The page's central claim is that a free count belongs
// to a RATE, not to the range the caller typed: a block tier runs for its own
// fixed duration from the arrival time, so a room taken later that night is
// still sellable for a 3-hour block this afternoon. These tests pin exactly
// that, plus the front_desk access the page needs.
//
// Run: npm run db:start && node supabase/tests/availability.test.mjs
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

// The window a guest asking "a room for tonight?" means, and the 3-hour block
// starting at the same arrival time. The block ends well before the overnight
// window does — that gap is what the page has to get right.
const ARRIVE = "2026-09-01T13:00:00Z";
const DEPART = "2026-09-02T12:00:00Z";
const BLOCK_END = "2026-09-01T16:00:00Z";
// A block booked in the evening: inside the overnight window, outside the
// afternoon block.
const EVENING = ["2026-09-01T18:00:00Z", "2026-09-01T21:00:00Z"];

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("availability lookup");
  await resetIdentity();
  const svc = adminBooking();
  await svc.from("payments").delete().not("id", "is", null);
  await svc.from("bookings").delete().not("id", "is", null);
  await svc.from("rooms").delete().not("id", "is", null);
  await svc.from("room_types").delete().not("id", "is", null);

  await createUser("owner@test.local", "Olivia Owner");
  const admin = await clientAs("owner@test.local");
  await admin.rpc("fn_claim_invitation");

  await svc.from("invitations").insert({ email: "desk@test.local", role: "front_desk" });
  await createUser("desk@test.local", "Dana Desk");
  const desk = await clientAs("desk@test.local");
  await desk.rpc("fn_claim_invitation");

  // One type, two rooms, both a block and an overnight rate.
  const { data: type } = await svc
    .from("room_types")
    .insert({ name: "Standard", base_occupancy: 2, max_occupancy: 3, excess_person_rate: 250 })
    .select("id")
    .single();
  await svc.from("rooms").insert([
    { room_type_id: type.id, label: "S1" },
    { room_type_id: type.id, label: "S2" },
  ]);
  const { data: tiers } = await svc
    .from("rate_tiers")
    .insert([
      { room_type_id: type.id, label: "3 hrs", kind: "block", duration_hours: 3, price: 500 },
      { room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1200 },
    ])
    .select("id, kind");
  const block = tiers.find((t) => t.kind === "block");
  const overnight = tiers.find((t) => t.kind === "overnight");

  const countFor = (client, checkIn, checkOut) =>
    client.rpc("fn_count_available", {
      p_room_type_id: type.id,
      p_check_in: checkIn,
      p_check_out: checkOut,
    });
  const roomsFor = (client, checkIn, checkOut) =>
    client.rpc("fn_available_rooms", {
      p_room_type_id: type.id,
      p_check_in: checkIn,
      p_check_out: checkOut,
    });

  await test("an empty night offers every room to both rates", async () => {
    const { data: overnightFree } = await countFor(desk, ARRIVE, DEPART);
    const { data: blockFree } = await countFor(desk, ARRIVE, BLOCK_END);
    assert.equal(overnightFree, 2);
    assert.equal(blockFree, 2);
  });

  await test("front_desk can list the free rooms by label", async () => {
    const { data, error } = await roomsFor(desk, ARRIVE, DEPART);
    assert.equal(error, null, error?.message);
    assert.deepEqual(
      data.map((r) => r.label),
      ["S1", "S2"]
    );
  });

  await test("an overnight booking removes exactly one room from both rates", async () => {
    const { data, error } = await admin.rpc("fn_create_booking", {
      p_guest_name: "Night Guest",
      p_guest_phone: "",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: overnight.id,
      p_guest_count: 2,
      p_check_in: ARRIVE,
      p_check_out: DEPART,
      p_source: "walk_in",
      p_notes: "",
    });
    assert.equal(error, null, error?.message);
    const taken = one(data).room_id;

    const { data: overnightFree } = await countFor(desk, ARRIVE, DEPART);
    const { data: blockFree } = await countFor(desk, ARRIVE, BLOCK_END);
    assert.equal(overnightFree, 1);
    assert.equal(blockFree, 1);

    const { data: free } = await roomsFor(desk, ARRIVE, DEPART);
    assert.equal(free.length, 1);
    assert.notEqual(free[0].id, taken, "the booked room must not be offered");
  });

  await test("an evening block leaves the afternoon block sellable but sells out the night", async () => {
    // The second room goes for 6–9pm: inside the overnight window, clear of
    // the 1–4pm block. This is the case the page exists to answer correctly.
    const { error } = await admin.rpc("fn_create_booking", {
      p_guest_name: "Evening Guest",
      p_guest_phone: "",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: block.id,
      p_guest_count: 2,
      p_check_in: EVENING[0],
      p_check_out: EVENING[1],
      p_source: "walk_in",
      p_notes: "",
    });
    assert.equal(error, null, error?.message);

    const { data: overnightFree } = await countFor(desk, ARRIVE, DEPART);
    const { data: blockFree } = await countFor(desk, ARRIVE, BLOCK_END);
    assert.equal(overnightFree, 0, "no room can be held for the whole night");
    assert.equal(blockFree, 1, "the 1–4pm block is still free in the evening room");
  });

  await test("a block that overlaps an existing block is not offered", async () => {
    // 5–8pm straddles the 6–9pm booking, so only the overnight-booked room
    // could take it — and that one is busy too.
    const { data } = await countFor(desk, "2026-09-01T17:00:00Z", "2026-09-01T20:00:00Z");
    assert.equal(data, 0);
  });

  await test("a fully booked night still lists no free rooms", async () => {
    const { data } = await roomsFor(desk, ARRIVE, DEPART);
    assert.equal(data.length, 0);
  });

  await test("the next night is untouched by tonight's bookings", async () => {
    const { data } = await countFor(desk, "2026-09-02T13:00:00Z", "2026-09-03T12:00:00Z");
    assert.equal(data, 2);
  });

  await test("anon cannot probe availability", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const { SUPABASE_URL, ANON_KEY } = await import("./_helpers.mjs");
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      db: { schema: "booking" },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: countErr } = await countFor(anon, ARRIVE, DEPART);
    const { error: roomsErr } = await roomsFor(anon, ARRIVE, DEPART);
    assert.ok(countErr, "fn_count_available must stay off the anon grant");
    assert.ok(roomsErr, "fn_available_rooms must stay off the anon grant");
  });

  console.log(`\nAll ${passed} tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
