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

  await test("admin creates a room type with occupancy + a rate tier", async () => {
    const { data, error } = await admin
      .from("room_types")
      .insert({
        name: "Deluxe Double",
        base_occupancy: 2,
        max_occupancy: 4,
        excess_person_rate: 350,
      })
      .select("id, base_occupancy, max_occupancy, excess_person_rate")
      .single();
    assert.equal(error, null, error?.message);
    assert.equal(data.base_occupancy, 2);
    assert.equal(data.max_occupancy, 4);
    assert.equal(Number(data.excess_person_rate), 350);
    typeId = data.id;

    const { error: tierErr } = await admin
      .from("rate_tiers")
      .insert({ room_type_id: typeId, label: "Overnight", kind: "overnight", price: 1800 });
    assert.equal(tierErr, null, tierErr?.message);
  });

  await test("duplicate room type name (case-insensitive) is rejected", async () => {
    const { error } = await admin
      .from("room_types")
      .insert({ name: "deluxe double", base_occupancy: 2, max_occupancy: 2 });
    assert.ok(error, "expected a unique-violation error");
  });

  await test("max_occupancy below base_occupancy is rejected by the check constraint", async () => {
    const { error } = await admin
      .from("room_types")
      .insert({ name: "Bad Occupancy", base_occupancy: 4, max_occupancy: 2 });
    assert.ok(error, "expected a check-constraint error");
  });

  await test("negative tier price is rejected by the check constraint", async () => {
    const { error } = await admin
      .from("rate_tiers")
      .insert({ room_type_id: typeId, label: "Bad", kind: "overnight", price: -1 });
    assert.ok(error, "expected a check-constraint error");
  });

  await test("a block tier without a duration is rejected", async () => {
    const { error } = await admin
      .from("rate_tiers")
      .insert({ room_type_id: typeId, label: "No Hours", kind: "block", price: 500 });
    assert.ok(error, "expected a check-constraint error");
  });

  await test("front_desk cannot create a room type (RLS denies)", async () => {
    const { data, error } = await desk
      .from("room_types")
      .insert({ name: "Sneaky Suite", base_occupancy: 4, max_occupancy: 4 })
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

  await test("anonymous visitor can read room types + tiers (portal inventory)", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { db: { schema: "booking" } });
    const { data, error } = await anon
      .from("room_types")
      .select("id, name, base_occupancy, rate_tiers(label, price)");
    assert.equal(error, null, error?.message);
    assert.ok(data.length >= 1, "anon should read at least the created type");
    assert.ok(
      data.some((t) => (t.rate_tiers ?? []).length >= 1),
      "anon should read tiers too"
    );
  });

  await test("room type photos come back ordered by sort_order", async () => {
    const { data: type } = await svc
      .from("room_types")
      .insert({ name: "Photo Type", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
      .select("id")
      .single();

    await svc.from("room_type_photos").insert([
      { room_type_id: type.id, storage_path: "c.jpg", url: "https://x.test/c.jpg", sort_order: 2 },
      { room_type_id: type.id, storage_path: "a.jpg", url: "https://x.test/a.jpg", sort_order: 0 },
      { room_type_id: type.id, storage_path: "b.jpg", url: "https://x.test/b.jpg", sort_order: 1 },
    ]);

    const { data } = await svc
      .from("room_type_photos")
      .select("url, sort_order")
      .eq("room_type_id", type.id)
      .order("sort_order");
    assert.deepEqual(
      data.map((p) => p.url),
      ["https://x.test/a.jpg", "https://x.test/b.jpg", "https://x.test/c.jpg"]
    );

    // Deleting the type cascades its photos.
    await svc.from("room_types").delete().eq("id", type.id);
    const { data: after } = await svc
      .from("room_type_photos")
      .select("id")
      .eq("room_type_id", type.id);
    assert.equal(after.length, 0);
  });

  // The migration backfill (`insert ... select ... where image_url is not
  // null and image_url <> '' and not exists (...)`) is never exercised by a
  // stock db:reset, since seed.sql sets no room type's image_url. Run the
  // same statement directly against freshly-inserted rows so the backfill
  // logic itself is under test, not just hand-verified.
  await test("migration backfill creates a photo row from a legacy image_url", async () => {
    const { data: withImage } = await svc
      .from("room_types")
      .insert({
        name: "Legacy Cover Type",
        base_occupancy: 2,
        max_occupancy: 2,
        excess_person_rate: 0,
        image_url: "https://x.test/legacy-cover.jpg",
      })
      .select("id")
      .single();

    // There's no raw-SQL RPC available to the JS client in this project (no
    // other test file uses one either), so replicate the migration's insert
    // ... select ... where ... not exists (...) statement clause-for-clause
    // via equivalent PostgREST calls against the same tables.
    const { data: candidates } = await svc
      .from("room_types")
      .select("id, image_url")
      .not("image_url", "is", null)
      .neq("image_url", "");
    const { data: existingPhotos } = await svc.from("room_type_photos").select("room_type_id");
    const alreadyHas = new Set((existingPhotos ?? []).map((p) => p.room_type_id));
    const toInsert = (candidates ?? [])
      .filter((rt) => !alreadyHas.has(rt.id))
      .map((rt) => ({ room_type_id: rt.id, storage_path: "", url: rt.image_url, sort_order: 0 }));
    if (toInsert.length) {
      const { error } = await svc.from("room_type_photos").insert(toInsert);
      assert.equal(error, null, error?.message);
    }

    // Assertion 1: would fail if the backfill inserted nothing, the wrong
    // url, or a non-zero sort_order for the legacy cover.
    const { data: rows } = await svc
      .from("room_type_photos")
      .select("url, sort_order, storage_path")
      .eq("room_type_id", withImage.id);
    assert.equal(rows.length, 1, "backfill should create exactly one photo row");
    assert.equal(rows[0].url, "https://x.test/legacy-cover.jpg");
    assert.equal(rows[0].sort_order, 0);

    // Assertion 2: re-run the same "not exists" guarded insert. Would fail
    // (row count > 1) if the `not exists` clause were dropped or broken.
    const { data: candidates2 } = await svc
      .from("room_types")
      .select("id, image_url")
      .not("image_url", "is", null)
      .neq("image_url", "");
    const { data: existingPhotos2 } = await svc.from("room_type_photos").select("room_type_id");
    const alreadyHas2 = new Set((existingPhotos2 ?? []).map((p) => p.room_type_id));
    const toInsert2 = (candidates2 ?? [])
      .filter((rt) => !alreadyHas2.has(rt.id))
      .map((rt) => ({ room_type_id: rt.id, storage_path: "", url: rt.image_url, sort_order: 0 }));
    assert.equal(toInsert2.length, 0, "no candidates should remain — guard should skip existing rows");
    if (toInsert2.length) await svc.from("room_type_photos").insert(toInsert2);
    const { data: afterRerun } = await svc
      .from("room_type_photos")
      .select("id")
      .eq("room_type_id", withImage.id);
    assert.equal(afterRerun.length, 1, "re-running the backfill must not create a duplicate");

    // Assertion 3: a type with no image_url (null) and one with '' should
    // get no row. Would fail if the `is not null` / `<> ''` guards were
    // dropped, since both would otherwise match a bare `select ... from
    // room_types` backfill.
    const { data: noImage } = await svc
      .from("room_types")
      .insert({ name: "No Cover Type", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
      .select("id")
      .single();
    const { data: blankImage } = await svc
      .from("room_types")
      .insert({
        name: "Blank Cover Type",
        base_occupancy: 2,
        max_occupancy: 2,
        excess_person_rate: 0,
        image_url: "",
      })
      .select("id")
      .single();

    const { data: candidates3 } = await svc
      .from("room_types")
      .select("id, image_url")
      .not("image_url", "is", null)
      .neq("image_url", "");
    const { data: existingPhotos3 } = await svc.from("room_type_photos").select("room_type_id");
    const alreadyHas3 = new Set((existingPhotos3 ?? []).map((p) => p.room_type_id));
    const toInsert3 = (candidates3 ?? [])
      .filter((rt) => !alreadyHas3.has(rt.id))
      .map((rt) => ({ room_type_id: rt.id, storage_path: "", url: rt.image_url, sort_order: 0 }));
    // Would fail (include noImage/blankImage) if the `is not null` / `<> ''`
    // guards were dropped from the where clause.
    assert.ok(
      !toInsert3.some((c) => c.room_type_id === noImage.id),
      "null image_url should not be a backfill candidate"
    );
    assert.ok(
      !toInsert3.some((c) => c.room_type_id === blankImage.id),
      "empty-string image_url should not be a backfill candidate"
    );
    if (toInsert3.length) await svc.from("room_type_photos").insert(toInsert3);
    const { data: noImagePhotos } = await svc
      .from("room_type_photos")
      .select("id")
      .eq("room_type_id", noImage.id);
    const { data: blankImagePhotos } = await svc
      .from("room_type_photos")
      .select("id")
      .eq("room_type_id", blankImage.id);
    assert.equal(noImagePhotos.length, 0, "null image_url should get no backfilled photo row");
    assert.equal(blankImagePhotos.length, 0, "empty image_url should get no backfilled photo row");
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
