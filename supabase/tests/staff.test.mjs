// Integration tests for the staff-management page (/users) against the real
// local stack. The page is admin-only and every mutation goes through the
// RLS-scoped server client, so what matters here is what the database itself
// enforces: who may read the roster, who may write invitations and roles, and
// that the write shapes the actions use (role replacement, invite renewal,
// deactivation) behave the way the UI assumes.
//
// Run: npm run db:start && node supabase/tests/staff.test.mjs
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

// Signs a user in and claims their invitation, the way the auth callback does.
async function signIn(email) {
  const client = await clientAs(email);
  const { data: claimed, error } = await client.rpc("fn_claim_invitation");
  if (error) throw error;
  return { client, claimed };
}

async function main() {
  console.log("staff management");
  await resetIdentity();
  const b = adminBooking();

  // Owner bootstrap (first user, empty profiles) + one invited front_desk.
  const adminId = await createUser("boss@test.local", "Bea Boss");
  const { client: adminClient } = await signIn("boss@test.local");

  await b
    .from("invitations")
    .insert({ email: "clerk@test.local", role: "front_desk", invited_by: adminId });
  const clerkId = await createUser("clerk@test.local", "Cleo Clerk");
  const { client: clerkClient } = await signIn("clerk@test.local");

  await test("admin reads the whole roster; front desk sees only itself", async () => {
    const { data: asAdmin } = await adminClient.from("profiles").select("id");
    assert.equal(asAdmin.length, 2, "admin should see both profiles");

    const { data: asClerk } = await clerkClient.from("profiles").select("id");
    assert.deepEqual(
      asClerk.map((p) => p.id),
      [clerkId],
      "front desk should see only their own profile"
    );
  });

  await test("invitations are admin-only, read and write", async () => {
    const { data: adminSees } = await adminClient.from("invitations").select("id");
    assert.equal(adminSees.length, 1, "admin should see the invitation");

    const { data: clerkSees } = await clerkClient.from("invitations").select("id");
    assert.equal(clerkSees.length, 0, "front desk should see no invitations");

    const { error } = await clerkClient
      .from("invitations")
      .insert({ email: "sneak@test.local", role: "admin" });
    assert.ok(error, "front desk must not be able to invite anyone");
  });

  await test("admin can invite; a second pending invite for the same email is rejected", async () => {
    const { error: first } = await adminClient
      .from("invitations")
      .insert({ email: "second@test.local", role: "front_desk", invited_by: adminId });
    assert.equal(first, null, first?.message);

    // This is why inviteStaff() renews the existing row instead of inserting:
    // the partial unique index allows only one pending invite per email.
    const { error: dupe } = await adminClient
      .from("invitations")
      .insert({ email: "SECOND@test.local", role: "admin", invited_by: adminId });
    assert.ok(dupe, "a duplicate pending invitation should be rejected");

    // Renewing the live row is the supported path and does succeed.
    const renewed = new Date(Date.now() + 14 * 864e5).toISOString();
    const { error: renewErr } = await adminClient
      .from("invitations")
      .update({ role: "admin", expires_at: renewed })
      .eq("email", "second@test.local")
      .eq("status", "pending");
    assert.equal(renewErr, null, renewErr?.message);
  });

  await test("role replacement leaves exactly one role", async () => {
    // setStaffRole()'s shape: insert the new role first, then drop the others,
    // so the member is never momentarily role-less.
    const { error: insErr } = await adminClient
      .from("user_roles")
      .upsert(
        { user_id: clerkId, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true }
      );
    assert.equal(insErr, null, insErr?.message);

    const { data: mid } = await b.from("user_roles").select("role").eq("user_id", clerkId);
    assert.equal(mid.length, 2, "both roles exist between the two writes");

    const { error: delErr } = await adminClient
      .from("user_roles")
      .delete()
      .eq("user_id", clerkId)
      .neq("role", "admin");
    assert.equal(delErr, null, delErr?.message);

    const { data: after } = await b.from("user_roles").select("role").eq("user_id", clerkId);
    assert.deepEqual(
      after.map((r) => r.role),
      ["admin"],
      "exactly the newly assigned role should remain"
    );

    // Put the clerk back where they started for the remaining tests.
    await b.from("user_roles").delete().eq("user_id", clerkId);
    await b.from("user_roles").insert({ user_id: clerkId, role: "front_desk" });
  });

  await test("front desk cannot grant itself a role", async () => {
    const { error } = await clerkClient
      .from("user_roles")
      .insert({ user_id: clerkId, role: "admin" });
    assert.ok(error, "non-admins must not write user_roles");
  });

  await test("deactivating keeps the profile but closes the access gate", async () => {
    const { error } = await adminClient
      .from("profiles")
      .update({ is_active: false })
      .eq("id", clerkId);
    assert.equal(error, null, error?.message);

    const { data: profile } = await b
      .from("profiles")
      .select("id, is_active")
      .eq("id", clerkId)
      .single();
    assert.equal(profile.is_active, false, "the row survives — audit logs reference it");

    // fn_is_active_user() is what the app's own guard mirrors (requireUser
    // redirects a deactivated profile to /login).
    const { data: stillActive } = await clerkClient.rpc("fn_is_active_user");
    assert.equal(stillActive, false, "a deactivated member no longer passes the gate");

    await adminClient.from("profiles").update({ is_active: true }).eq("id", clerkId);
  });

  await test("front desk cannot reactivate or rename anyone", async () => {
    await adminClient.from("profiles").update({ is_active: false }).eq("id", clerkId);

    // No error surfaces — RLS filters the row out of the UPDATE, so nothing
    // is written. The check is that the value is unchanged.
    await clerkClient.from("profiles").update({ is_active: true }).eq("id", clerkId);
    const { data: profile } = await b
      .from("profiles")
      .select("is_active")
      .eq("id", clerkId)
      .single();
    assert.equal(profile.is_active, false, "a deactivated member cannot restore themselves");

    await b.from("profiles").update({ is_active: true }).eq("id", clerkId);
  });

  await test("a revoked invitation cannot be claimed", async () => {
    await b
      .from("invitations")
      .insert({ email: "ghost@test.local", role: "front_desk", invited_by: adminId });
    const { error } = await adminClient
      .from("invitations")
      .update({ status: "revoked" })
      .eq("email", "ghost@test.local")
      .eq("status", "pending");
    assert.equal(error, null, error?.message);

    const ghostId = await createUser("ghost@test.local", "Gus Ghost");
    const { claimed } = await signIn("ghost@test.local");
    assert.equal(claimed, false, "a revoked invitation grants no access");

    const { data: profile } = await b.from("profiles").select("id").eq("id", ghostId).maybeSingle();
    assert.equal(profile, null, "no profile should be provisioned");
  });

  await test("an expired invitation cannot be claimed", async () => {
    await b.from("invitations").insert({
      email: "late@test.local",
      role: "front_desk",
      invited_by: adminId,
      expires_at: new Date(Date.now() - 864e5).toISOString(),
    });

    const lateId = await createUser("late@test.local", "Lars Late");
    const { claimed } = await signIn("late@test.local");
    assert.equal(claimed, false, "an expired invitation grants no access");

    const { data: profile } = await b.from("profiles").select("id").eq("id", lateId).maybeSingle();
    assert.equal(profile, null, "no profile should be provisioned");
  });

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
