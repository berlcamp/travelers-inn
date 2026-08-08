// Integration tests for the Collections Report (/collections) against the real
// local stack. The page is a remittance sheet: what a receptionist received and
// is about to hand over, so the assertions here are about ATTRIBUTION and
// ACCESS rather than arithmetic (the maths is unit-tested in collections.test.ts).
//
// Three things have to hold, and all three are easy to get wrong:
//   1. A front-desk clerk can read the payments ledger at all. It works because
//      `payments_staff_read` (migration 8) is gated on fn_is_active_user, not
//      on a role — which is what lets this page exist without a new SECURITY
//      DEFINER reader.
//   2. The embed the repository uses (payment → booking → room / room_type)
//      survives RLS for that clerk, so the sheet can name the guest and room.
//   3. Names come from fn_staff_names, NOT from profiles — front desk may not
//      read colleagues' profiles, which carry emails.
//
// Run: npm run db:start && node supabase/tests/remittance.test.mjs
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  adminBooking,
  createUser,
  clientAs,
  resetIdentity,
  SUPABASE_URL,
  ANON_KEY,
} from "./_helpers.mjs";

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

// The exact select the collections repository issues. Kept here verbatim on
// purpose: a typo in a nested embed is a runtime error PostgREST only reports
// when the query runs, which a type-check can never catch.
const COLLECTION_SELECT =
  "id, booking_id, amount, method, reference, created_at, recorded_by, " +
  "booking:bookings(reference_code, guest_name, source, room:rooms(label), room_type:room_types(name))";

const W = ["2026-12-10T14:00:00Z", "2026-12-12T12:00:00Z"]; // 2 nights
const one = (data) => (Array.isArray(data) ? data[0] : data);

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  console.log("collections / remittance");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null); // cascades to payments
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await b.from("audit_logs").delete().not("id", "is", null);

  // Owner bootstrap + two clerks: one books and takes the deposit, the other
  // is on the next shift and collects the balance.
  const adminId = await createUser("owner3@test.local", "Ada Owner");
  const adminClient = await clientAs("owner3@test.local");
  await adminClient.rpc("fn_claim_invitation");

  const invite = (email) =>
    b.from("invitations").insert({ email, role: "front_desk", invited_by: adminId });

  await invite("dana@test.local");
  const danaId = await createUser("dana@test.local", "Dana Desk");
  const dana = await clientAs("dana@test.local");
  await dana.rpc("fn_claim_invitation");

  await invite("ray@test.local");
  const rayId = await createUser("ray@test.local", "Ray Night");
  const ray = await clientAs("ray@test.local");
  await ray.rpc("fn_claim_invitation");

  const { data: type } = await b
    .from("room_types")
    .insert({
      name: "Remittance Suite",
      base_occupancy: 2,
      max_occupancy: 2,
      excess_person_rate: 0,
    })
    .select("id")
    .single();
  await b.from("rooms").insert({ room_type_id: type.id, label: "R1" });
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1500 })
    .select("id")
    .single();

  // Dana takes the booking. Two nights at 1500 = 3000.
  const { data: created, error: bookErr } = await dana.rpc("fn_create_booking", {
    p_guest_name: "Remy Guest",
    p_guest_phone: "09170000002",
    p_guest_email: "",
    p_room_type_id: type.id,
    p_rate_tier_id: tier.id,
    p_guest_count: 2,
    p_check_in: W[0],
    p_check_out: W[1],
    p_source: "walk_in",
    p_notes: "",
    p_status: "confirmed",
  });
  assert.equal(bookErr, null, bookErr?.message);
  const booking = one(created);

  // The split that makes this report necessary: Dana books and takes a cash
  // deposit; Ray, on the next shift, collects the GCash balance. The booking is
  // Dana's; half the money is Ray's to hand over.
  const day = "2026-08-06";
  await b.from("payments").insert([
    {
      booking_id: booking.id,
      amount: 1000,
      method: "cash",
      recorded_by: danaId,
      created_at: `${day}T09:30:00+08:00`,
    },
    {
      booking_id: booking.id,
      amount: 2000,
      method: "gcash",
      reference: "GC-88231",
      recorded_by: rayId,
      created_at: `${day}T23:50:00+08:00`,
    },
  ]);

  await test("a front-desk clerk can read the payments ledger with its embeds", async () => {
    const { data, error } = await dana.from("payments").select(COLLECTION_SELECT);
    assert.equal(error, null, error?.message);
    assert.equal(data.length, 2, "the ledger is not scoped to the caller by RLS");
    const row = data.find((p) => Number(p.amount) === 1000);
    assert.equal(row.booking.guest_name, "Remy Guest");
    assert.equal(row.booking.reference_code, booking.reference_code);
    assert.equal(row.booking.source, "walk_in");
    assert.equal(row.booking.room.label, "R1", "the sheet must be able to name the room");
    assert.equal(row.booking.room_type.name, "Remittance Suite");
  });

  await test("each clerk's sheet holds what THEY received, not what they sold", async () => {
    // Dana took the booking and all 3000 of its value, but only handled 1000.
    const { data: hers } = await dana
      .from("payments")
      .select(COLLECTION_SELECT)
      .eq("recorded_by", danaId);
    assert.equal(hers.length, 1);
    assert.equal(Number(hers[0].amount), 1000);
    assert.equal(hers[0].method, "cash");

    const { data: his } = await ray
      .from("payments")
      .select(COLLECTION_SELECT)
      .eq("recorded_by", rayId);
    assert.equal(his.length, 1);
    assert.equal(Number(his[0].amount), 2000);
    assert.equal(his[0].reference, "GC-88231");
    assert.equal(Number(booking.quoted_total), 3000, "and the two together settle the booking");
  });

  await test("the day window is inclusive of its last minute", async () => {
    // Exactly what the repository sends: >= local midnight, < the next.
    const start = new Date(`${day}T00:00:00`).toISOString();
    const end = new Date(`${day}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const { data } = await dana
      .from("payments")
      .select("id, amount")
      .gte("created_at", start)
      .lt("created_at", end.toISOString());
    // The 23:50 payment is the one a naive `lte(day)` would drop, taking
    // ₱2,000 off the sheet the clerk is signing.
    assert.equal(data.length, 2, "a payment at 23:50 belongs to that day");
  });

  await test("fn_staff_names names the recorder without exposing profiles", async () => {
    const { data, error } = await dana.rpc("fn_staff_names", { p_ids: [danaId, rayId] });
    assert.equal(error, null, error?.message);
    const names = Object.fromEntries(data.map((r) => [r.staff_id, r.staff_name]));
    assert.equal(names[danaId], "Dana Desk");
    assert.equal(names[rayId], "Ray Night");
    assert.equal(Object.keys(data[0]).includes("email"), false, "names only, never emails");

    // The reason the function exists: the direct read is refused.
    const { data: profiles } = await dana.from("profiles").select("id, email").eq("id", rayId);
    assert.equal(profiles.length, 0, "front desk may not read a colleague's profile row");
  });

  await test("an anonymous visitor cannot read the ledger", async () => {
    const anon = anonClient();
    const { data } = await anon.from("payments").select("id, amount");
    assert.equal((data ?? []).length, 0, "payments are staff-only");
  });

  await test("a deactivated clerk loses the ledger with the rest of the app", async () => {
    await b.from("profiles").update({ is_active: false }).eq("id", rayId);
    const { data } = await ray.from("payments").select("id");
    assert.equal((data ?? []).length, 0, "payments_staff_read is gated on fn_is_active_user");
    const { data: named } = await ray.rpc("fn_staff_names", { p_ids: [danaId] });
    assert.equal((named ?? []).length, 0, "and so is fn_staff_names");
    await b.from("profiles").update({ is_active: true }).eq("id", rayId);
  });

  if (process.exitCode) {
    console.error(`\n${passed} passed, with failures.`);
  } else {
    console.log(`\nAll ${passed} tests passed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
