// Integration test for the admin-only booking DELETE against the real local
// stack (migration 20260817000100). The point of the migration is a boundary
// that used to be open: `bookings_staff_write` was `for all`, so front desk
// could erase a booking, its payments and its proofs with one REST call. Most
// of these tests are therefore negative — the interesting behaviour is who is
// REFUSED, and RLS refuses silently (a filtered DELETE is not an error, it is
// zero rows), so every refusal is asserted by the row still being there.
//
// Run: npm run db:start && node supabase/tests/delete-booking.test.mjs
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

function one(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("booking delete (admin only)");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null); // cascades to payments + proofs
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await b.from("audit_logs").delete().not("id", "is", null);

  const adminId = await createUser("owner-del@test.local", "Olivia Owner");
  const admin = await clientAs("owner-del@test.local");
  await admin.rpc("fn_claim_invitation");

  await b.from("invitations").insert({
    email: "desk-del@test.local",
    role: "front_desk",
    invited_by: adminId,
  });
  await createUser("desk-del@test.local", "Dana Desk");
  const desk = await clientAs("desk-del@test.local");
  await desk.rpc("fn_claim_invitation");

  const { data: type } = await b
    .from("room_types")
    .insert({ name: "Delete Test", base_occupancy: 2, max_occupancy: 2, excess_person_rate: 0 })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: type.id, label: "X1" });
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1000 })
    .select("id")
    .single();

  // Each case books its own window, so a row surviving a refused delete can't
  // block the next booking on the single room.
  let day = 1;
  async function makeBooking() {
    const from = `2026-10-${String(day).padStart(2, "0")}T14:00:00Z`;
    const to = `2026-10-${String(day + 1).padStart(2, "0")}T12:00:00Z`;
    day += 2;
    const { data, error } = await admin.rpc("fn_create_booking", {
      p_guest_name: "Delete Me",
      p_guest_phone: "",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: from,
      p_check_out: to,
      p_source: "walk_in",
      p_notes: "",
    });
    if (error) throw error;
    return one(data);
  }

  const exists = async (id) => {
    const { data } = await b.from("bookings").select("id").eq("id", id).maybeSingle();
    return Boolean(data);
  };

  await test("front desk cannot delete a booking", async () => {
    const bk = await makeBooking();
    const { error } = await desk.from("bookings").delete().eq("id", bk.id);
    // RLS filters the row out rather than raising: the call "succeeds" and
    // removes nothing, which is exactly why the action checks the returned
    // rows instead of trusting a missing error.
    assert.equal(error, null, "a filtered delete is not an error");
    assert.ok(await exists(bk.id), "the booking must survive");
  });

  await test("front desk can still update a booking", async () => {
    // Splitting `for all` into per-command policies must not cost front desk
    // the writes it needs to do its job.
    const bk = await makeBooking();
    const { error } = await desk.from("bookings").update({ notes: "late arrival" }).eq("id", bk.id);
    assert.equal(error, null, error?.message);
    const { data } = await b.from("bookings").select("notes").eq("id", bk.id).single();
    assert.equal(data.notes, "late arrival");
  });

  await test("anon cannot delete a booking", async () => {
    const bk = await makeBooking();
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      db: { schema: "booking" },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await anon.from("bookings").delete().eq("id", bk.id);
    assert.ok(await exists(bk.id), "the booking must survive");
  });

  await test("admin deletes the booking", async () => {
    const bk = await makeBooking();
    const { data, error } = await admin.from("bookings").delete().eq("id", bk.id).select("id");
    assert.equal(error, null, error?.message);
    assert.equal(data.length, 1, "one row deleted");
    assert.equal(await exists(bk.id), false);
  });

  await test("payments and proofs cascade away with it", async () => {
    const bk = await makeBooking();
    await b.from("payments").insert({ booking_id: bk.id, amount: 1000, method: "cash" });
    await b.from("booking_proofs").insert({
      booking_id: bk.id,
      method: "gcash",
      declared_amount: 500,
      storage_path: `${bk.id}/proof.jpg`,
    });

    await admin.from("bookings").delete().eq("id", bk.id);

    const { data: pays } = await b.from("payments").select("id").eq("booking_id", bk.id);
    const { data: proofs } = await b.from("booking_proofs").select("id").eq("booking_id", bk.id);
    assert.equal(pays.length, 0, "payments cascade");
    assert.equal(proofs.length, 0, "proofs cascade");
  });

  await test("the audit trail outlives the booking it names", async () => {
    // audit_logs.entity_id is a plain uuid with no FK, which is what lets the
    // booking.delete snapshot survive the row it describes. If a foreign key
    // were ever added, this deletion would either fail or take the record of
    // itself with it.
    const bk = await makeBooking();
    await b.from("audit_logs").insert({
      actor_id: adminId,
      action: "booking.delete",
      entity: "booking",
      entity_id: bk.id,
      diff: { reference_code: bk.reference_code, quoted_total: bk.quoted_total },
    });

    await admin.from("bookings").delete().eq("id", bk.id);

    const { data } = await b.from("audit_logs").select("action, diff").eq("entity_id", bk.id);
    assert.equal(data.length, 1, "the audit entry remains");
    assert.equal(data[0].diff.reference_code, bk.reference_code);
  });

  await test("a deactivated admin cannot delete", async () => {
    // fn_is_admin() alone doesn't look at is_active, so the policy pairs it
    // with fn_is_active_user(). Without that, a deactivated owner holding a
    // still-valid JWT could still erase bookings straight through PostgREST,
    // with only proxy.ts standing in the way.
    const bk = await makeBooking();
    await b.from("profiles").update({ is_active: false }).eq("id", adminId);
    try {
      await admin.from("bookings").delete().eq("id", bk.id);
      assert.ok(await exists(bk.id), "the booking must survive");
    } finally {
      await b.from("profiles").update({ is_active: true }).eq("id", adminId);
    }
  });

  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await b.from("audit_logs").delete().not("id", "is", null);
  await resetIdentity();

  if (process.exitCode) console.error(`\n${passed} passed, with failures.`);
  else console.log(`\nAll ${passed} tests passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
