// Integration tests for booking staff attribution against the real local
// stack: who took the booking, who verified the deposit, who received each
// payment, and who may read that trail.
//
// The load-bearing assertions are the two SECURITY DEFINER readers added in
// migration 20260806000100. They exist so front desk can see "checked in by
// Dana Desk" WITHOUT gaining read access to audit_logs (which also holds
// settings and role changes) or to profiles (which hold emails). If either
// function ever leaks past active staff, this file fails.
//
// Run: npm run db:start && node supabase/tests/attribution.test.mjs
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

const W = ["2026-11-10T14:00:00Z", "2026-11-12T12:00:00Z"]; // 2 nights
const one = (data) => (Array.isArray(data) ? data[0] : data);

function anonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    db: { schema: "booking" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  console.log("booking attribution");
  await resetIdentity();
  const b = adminBooking();
  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await b.from("audit_logs").delete().not("id", "is", null);

  // Owner bootstrap + an invited front-desk clerk.
  const adminId = await createUser("owner2@test.local", "Ada Owner");
  const adminClient = await clientAs("owner2@test.local");
  await adminClient.rpc("fn_claim_invitation");

  await b
    .from("invitations")
    .insert({ email: "desk2@test.local", role: "front_desk", invited_by: adminId });
  const clerkId = await createUser("desk2@test.local", "Dana Desk");
  const clerkClient = await clientAs("desk2@test.local");
  await clerkClient.rpc("fn_claim_invitation");

  const { data: type } = await b
    .from("room_types")
    .insert({
      name: "Attribution Suite",
      base_occupancy: 2,
      max_occupancy: 2,
      excess_person_rate: 0,
    })
    .select("id")
    .single();
  await b.from("rooms").insert([
    { room_type_id: type.id, label: "A1" },
    { room_type_id: type.id, label: "A2" },
  ]);
  const { data: tier } = await b
    .from("rate_tiers")
    .insert({ room_type_id: type.id, label: "Overnight", kind: "overnight", price: 1500 })
    .select("id")
    .single();

  const makeBooking = (client, name, status) =>
    client.rpc("fn_create_booking", {
      p_guest_name: name,
      p_guest_phone: "09170000001",
      p_guest_email: "",
      p_room_type_id: type.id,
      p_rate_tier_id: tier.id,
      p_guest_count: 2,
      p_check_in: W[0],
      p_check_out: W[1],
      p_source: status === "pending_verification" ? "portal" : "walk_in",
      p_notes: "",
      p_status: status,
    });

  let walkIn;
  let portal;

  await test("a walk-in records the staff member who took it", async () => {
    const { data, error } = await makeBooking(clerkClient, "Walk-in Wanda", "confirmed");
    assert.equal(error, null, error?.message);
    walkIn = one(data);
    assert.equal(walkIn.created_by, clerkId, "created_by must be the signed-in clerk");
    assert.equal(walkIn.verified_by, null, "a walk-in has no separate verifier");
  });

  await test("a portal booking has no staff creator — the guest made it", async () => {
    // The portal runs through the service-role admin client, exactly as
    // features/portal/actions.ts does, so auth.uid() is null.
    const { data, error } = await makeBooking(b, "Portal Pia", "pending_verification");
    assert.equal(error, null, error?.message);
    portal = one(data);
    assert.equal(portal.created_by, null);
    assert.equal(portal.source, "portal");
  });

  await test("verifying a deposit stamps the verifier atomically with the status flip", async () => {
    // Mirrors verification-actions.ts confirmBooking: the attribution rides in
    // the same conditional UPDATE as the status change.
    const verifiedAt = new Date().toISOString();
    const { data: updated } = await clerkClient
      .from("bookings")
      .update({ status: "confirmed", verified_by: clerkId, verified_at: verifiedAt })
      .eq("id", portal.id)
      .eq("status", "pending_verification")
      .select("id, verified_by, verified_at")
      .maybeSingle();
    assert.ok(updated, "the first update wins the race");
    assert.equal(updated.verified_by, clerkId);
    assert.ok(updated.verified_at, "verified_at is set");

    // A second staff member arriving late changes nothing — the WHERE no
    // longer matches, so the original verifier is not overwritten.
    const { data: second } = await adminClient
      .from("bookings")
      .update({ status: "confirmed", verified_by: adminId, verified_at: new Date().toISOString() })
      .eq("id", portal.id)
      .eq("status", "pending_verification")
      .select("id")
      .maybeSingle();
    assert.equal(second, null, "the loser of the race must not re-stamp the verifier");

    const { data: after } = await b
      .from("bookings")
      .select("verified_by")
      .eq("id", portal.id)
      .single();
    assert.equal(after.verified_by, clerkId, "the verifier stays whoever actually verified");
  });

  await test("payments record the staff member who received them, with mode and amount", async () => {
    const { error } = await clerkClient.from("payments").insert({
      booking_id: walkIn.id,
      amount: 1500,
      method: "gcash",
      reference: "GC-12345",
      recorded_by: clerkId,
    });
    assert.equal(error, null, error?.message);

    const { data: rows } = await b
      .from("payments")
      .select("amount, method, reference, recorded_by")
      .eq("booking_id", walkIn.id);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].amount), 1500);
    assert.equal(rows[0].method, "gcash");
    assert.equal(rows[0].recorded_by, clerkId);

    // The existing trigger derives payment_status from the ledger: 2 nights at
    // 1500 is 3000 quoted, so a single 1500 payment leaves it partial.
    const { data: booking } = await b
      .from("bookings")
      .select("quoted_total, payment_status")
      .eq("id", walkIn.id)
      .single();
    assert.equal(Number(booking.quoted_total), 3000);
    assert.equal(booking.payment_status, "partial");

    // Settling the balance with a second payment, received by someone else,
    // is the case the reports break down by staff and by mode.
    await adminClient.from("payments").insert({
      booking_id: walkIn.id,
      amount: 1500,
      method: "cash",
      recorded_by: adminId,
    });
    const { data: settled } = await b
      .from("bookings")
      .select("payment_status")
      .eq("id", walkIn.id)
      .single();
    assert.equal(settled.payment_status, "paid");

    const { data: all } = await b
      .from("payments")
      .select("recorded_by")
      .eq("booking_id", walkIn.id);
    assert.equal(
      new Set(all.map((p) => p.recorded_by)).size,
      2,
      "two different staff received money against one booking"
    );
  });

  await test("fn_booking_trail returns this booking's audit entries with actor names", async () => {
    // logAudit writes through the service-role client, same as the app.
    //
    // The two entries whose ORDER is asserted go in as separate statements, on
    // purpose: `created_at` defaults to now(), which is TRANSACTION time, so a
    // multi-row insert stamps every row with the same instant and the
    // function's `order by created_at` is left with a tie it breaks
    // arbitrarily. logAudit is one call per event, so in the app these entries
    // always land in separate transactions with distinct timestamps — that is
    // what makes "oldest first" a real ordering, and what this reproduces.
    await b.from("audit_logs").insert({
      actor_id: clerkId,
      action: "booking.create",
      entity: "booking",
      entity_id: walkIn.id,
      diff: { source: "walk_in" },
    });
    await b.from("audit_logs").insert({
      actor_id: clerkId,
      action: "payment.record",
      entity: "booking",
      entity_id: walkIn.id,
      diff: { amount: 1500, method: "gcash" },
    });
    // Nothing asserts the order of these two, so one statement is fine.
    await b.from("audit_logs").insert([
      // A different booking's entry, to prove the scoping works.
      { actor_id: adminId, action: "booking.cancel", entity: "booking", entity_id: portal.id },
      // A non-booking entry the trail must never surface.
      { actor_id: adminId, action: "settings.update", entity: "settings", entity_id: null },
    ]);

    const { data, error } = await clerkClient.rpc("fn_booking_trail", {
      p_booking_id: walkIn.id,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data.length, 2, "only this booking's entries");
    assert.deepEqual(
      data.map((r) => r.action),
      ["booking.create", "payment.record"],
      "oldest first"
    );
    assert.equal(data[0].actor_name, "Dana Desk", "the actor's name is resolved");
    assert.equal(data[1].diff.method, "gcash", "the diff rides along for detail");
  });

  await test("the trail cannot reach non-booking audit entries", async () => {
    const { data } = await clerkClient.rpc("fn_booking_trail", { p_booking_id: portal.id });
    assert.ok(
      data.every((r) => r.action !== "settings.update"),
      "settings changes are admin-only and stay that way"
    );
  });

  await test("front desk still cannot read audit_logs or profiles directly", async () => {
    const { data: logs } = await clerkClient.from("audit_logs").select("id");
    assert.equal(logs.length, 0, "audit_logs remains admin-only");

    const { data: profiles } = await clerkClient.from("profiles").select("id, email");
    assert.deepEqual(
      profiles.map((p) => p.id),
      [clerkId],
      "profiles (and the emails on them) stay self-only for front desk"
    );
  });

  await test("fn_staff_names resolves names for active staff, and only names", async () => {
    const { data, error } = await clerkClient.rpc("fn_staff_names", {
      p_ids: [clerkId, adminId],
    });
    assert.equal(error, null, error?.message);
    const names = Object.fromEntries(data.map((r) => [r.staff_id, r.staff_name]));
    assert.equal(names[clerkId], "Dana Desk");
    assert.equal(names[adminId], "Ada Owner", "front desk can name a colleague…");
    assert.deepEqual(
      Object.keys(data[0]).sort(),
      ["staff_id", "staff_name"],
      "…but gets nothing else about them"
    );
  });

  await test("a deactivated staff member can no longer read either", async () => {
    await b.from("profiles").update({ is_active: false }).eq("id", clerkId);

    const { data: trail } = await clerkClient.rpc("fn_booking_trail", {
      p_booking_id: walkIn.id,
    });
    assert.deepEqual(trail, [], "the trail closes with the account");

    const { data: names } = await clerkClient.rpc("fn_staff_names", { p_ids: [adminId] });
    assert.deepEqual(names, [], "so does the name lookup");

    await b.from("profiles").update({ is_active: true }).eq("id", clerkId);
  });

  await test("SECURITY REGRESSION: anon cannot execute either reader", async () => {
    const anon = anonClient();
    const { error: trailErr } = await anon.rpc("fn_booking_trail", { p_booking_id: walkIn.id });
    assert.ok(trailErr, "anon must be denied fn_booking_trail");
    const { error: nameErr } = await anon.rpc("fn_staff_names", { p_ids: [clerkId] });
    assert.ok(nameErr, "anon must be denied fn_staff_names");
  });

  await b.from("bookings").delete().not("id", "is", null);
  await b.from("rooms").delete().not("id", "is", null);
  await b.from("room_types").delete().not("id", "is", null);
  await b.from("audit_logs").delete().not("id", "is", null);
  await resetIdentity();

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
