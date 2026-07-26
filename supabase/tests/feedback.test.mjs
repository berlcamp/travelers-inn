// Integration tests for guest feedback. The security property under test: the
// feedback table is NOT reachable from an anon client — only the SECURITY
// DEFINER function may write, and anon may not read at all. Also regression-
// tests the anon EXECUTE revocation (migration 20260726000600) for the two
// functions that matter most: fn_submit_feedback (this table's only writer)
// and fn_create_booking (the severe case — p_status defaults to 'confirmed').
//
// Run: npm run db:start && node supabase/tests/feedback.test.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { adminBooking, resetIdentity, SUPABASE_URL, ANON_KEY } from "./_helpers.mjs";

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

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// A permission-denied RPC failure must carry SQLSTATE 42501 (or the matching
// PostgREST message) — anything else (bad args, unknown row, business-rule
// rejection) means the call reached the function body, which would prove the
// grant is still open rather than revoked.
function assertPermissionDenied(error, label) {
  assert.ok(error, `${label}: expected an error, got none`);
  const isPermissionError =
    error.code === "42501" || /permission denied/i.test(error.message ?? "");
  assert.ok(
    isPermissionError,
    `${label}: expected a permission-denied error (42501 / "permission denied"), got code=${error.code} message=${error.message}`,
  );
}

async function main() {
  console.log("guest feedback");
  await resetIdentity();
  const b = adminBooking();
  await b.from("feedback").delete().not("id", "is", null);
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);

  const { data: type } = await b
    .from("room_types")
    .insert({ name: "FB Type", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  const { data: room } = await b
    .from("rooms")
    .insert({ room_type_id: type.id, label: "F1" })
    .select("id")
    .single();

  await test("fn_submit_feedback inserts and returns the row", async () => {
    const { data, error } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 5,
      p_comment: "Spotless and quiet.",
      p_guest_name: "Ana",
    });
    assert.equal(error, null);
    const row = one(data);
    assert.equal(row.rating, 5);
    assert.equal(row.comment, "Spotless and quiet.");
    assert.equal(row.guest_name, "Ana");
    assert.equal(row.room_id, room.id);
  });

  await test("blank comment and name normalise to null", async () => {
    const { data } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 4,
      p_comment: "   ",
      p_guest_name: "",
    });
    const row = one(data);
    assert.equal(row.comment, null);
    assert.equal(row.guest_name, null);
  });

  await test("a rating outside 1–5 is rejected", async () => {
    const { error } = await b.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 9,
      p_comment: "",
      p_guest_name: "",
    });
    assert.notEqual(error, null);
    assert.match(error.message, /between 1 and 5/);
  });

  await test("an unknown room is rejected", async () => {
    const { error } = await b.rpc("fn_submit_feedback", {
      p_room_id: "00000000-0000-0000-0000-000000000000",
      p_rating: 5,
      p_comment: "",
      p_guest_name: "",
    });
    assert.notEqual(error, null);
    assert.match(error.message, /could not be found/);
  });

  await test("anon cannot read the feedback table", async () => {
    const anon = anonClient();
    const { data } = await anon.from("feedback").select("id");
    assert.deepEqual(data ?? [], [], "anon must not be able to list feedback");
  });

  await test("deleting a room cascades its feedback", async () => {
    await b.from("rooms").delete().eq("id", room.id);
    const { data } = await b.from("feedback").select("id").eq("room_id", room.id);
    assert.equal(data.length, 0);
  });

  // --- Security regression: anon EXECUTE revocation (migration 20260726000600) ---
  //
  // Every SECURITY DEFINER function in `booking` inherited a live anon
  // EXECUTE grant from migration 1's `alter default privileges ... grant all
  // on routines to anon, authenticated, service_role`. That was fixed by
  // revoking EXECUTE from anon/public on the functions anon has no business
  // calling. Nothing exercised that revocation before this suite. These two
  // tests call the RPCs with a valid room/args — matching real inputs a
  // caller who owns the anon key could send — through an anon-key client, so
  // the only way they can fail is the Postgres grant itself. If the grant
  // regressed, the call would proceed past the permission check straight
  // into the function body (returning data or a business-rule error like
  // "between 1 and 5" or "No rooms of that type are free"), not a
  // permission-denied error — which is exactly what we assert against.

  await test("SECURITY REGRESSION: anon cannot execute fn_submit_feedback directly", async () => {
    const anon = anonClient();
    const { data, error } = await anon.rpc("fn_submit_feedback", {
      p_room_id: room.id,
      p_rating: 5,
      p_comment: "should never land",
      p_guest_name: "Attacker",
    });
    assertPermissionDenied(error, "fn_submit_feedback");
    assert.equal(data, null, "no data should come back on a permission-denied call");

    // Prove it didn't silently insert despite the anon-perceived error.
    const { data: rows } = await b
      .from("feedback")
      .select("id")
      .eq("comment", "should never land");
    assert.equal(rows.length, 0, "the anon call must not have written a row");
  });

  await test("SECURITY REGRESSION: anon cannot execute fn_create_booking directly", async () => {
    const anon = anonClient();
    const { data: tier } = await b
      .from("rate_tiers")
      .insert({ room_type_id: type.id, label: "Anon Guard", kind: "overnight", price: 1000 })
      .select("id")
      .single();

    const { data, error } = await anon.rpc("fn_create_booking", {
      p_guest_name: "Anon Attacker",
      p_guest_phone: "09170000099",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: "2027-03-01T14:00:00Z",
      p_check_out: "2027-03-02T12:00:00Z",
      p_source: "portal",
      p_notes: "",
      // p_status omitted deliberately: this is the dangerous default-to-
      // 'confirmed' path the vulnerability made reachable straight from a
      // browser with no deposit and no proof.
    });
    assertPermissionDenied(error, "fn_create_booking");
    assert.equal(data, null, "no data should come back on a permission-denied call");

    // Prove no booking was actually created for "Anon Attacker".
    const { data: rows } = await b
      .from("bookings")
      .select("id")
      .eq("guest_name", "Anon Attacker");
    assert.equal(rows.length, 0, "the anon call must not have created a booking");
  });

  console.log(`\n${passed} passed`);
}

main();
