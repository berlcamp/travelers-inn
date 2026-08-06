// Integration tests for self-service profile editing (/profile) against the
// real local stack.
//
// The whole point of routing this through `fn_update_my_profile` instead of a
// self-update RLS policy is that a row-level policy would have granted the
// whole row. So the tests that matter are the negative ones: that the direct
// UPDATE is still refused, and that the function cannot be talked into
// touching `is_active`, `email`, or somebody else's row.
//
// Run: npm run db:start && node supabase/tests/profile.test.mjs
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
  const { error } = await client.rpc("fn_claim_invitation");
  if (error) throw error;
  return client;
}

async function main() {
  console.log("profile self-service");
  await resetIdentity();
  const b = adminBooking();

  // Owner bootstrap (first user, empty profiles) + one invited front_desk.
  const adminId = await createUser("boss@test.local", "Bea Boss");
  const adminClient = await signIn("boss@test.local");

  await b
    .from("invitations")
    .insert({ email: "clerk@test.local", role: "front_desk", invited_by: adminId });
  const clerkId = await createUser("clerk@test.local", "Cleo Clerk");
  const clerkClient = await signIn("clerk@test.local");

  await test("front desk can rename themselves", async () => {
    const { data, error } = await clerkClient.rpc("fn_update_my_profile", {
      p_full_name: "Cleo Clerk-Reyes",
    });
    assert.equal(error, null, "the rename should succeed");
    assert.equal(data.full_name, "Cleo Clerk-Reyes");
    assert.equal(data.id, clerkId, "it must return the caller's own row");

    const { data: row } = await b
      .from("profiles")
      .select("full_name")
      .eq("id", clerkId)
      .maybeSingle();
    assert.equal(row.full_name, "Cleo Clerk-Reyes", "the change must be persisted");
  });

  await test("the name is trimmed, and blank is refused", async () => {
    const { data } = await clerkClient.rpc("fn_update_my_profile", {
      p_full_name: "   Cleo Clerk   ",
    });
    assert.equal(data.full_name, "Cleo Clerk", "surrounding whitespace is stripped");

    for (const blank of ["", "   ", null]) {
      const { error } = await clerkClient.rpc("fn_update_my_profile", { p_full_name: blank });
      assert.ok(error, `"${blank}" must be refused, not written`);
    }

    const { error: tooLong } = await clerkClient.rpc("fn_update_my_profile", {
      p_full_name: "x".repeat(121),
    });
    assert.ok(tooLong, "a name over 120 characters must be refused");

    const { data: row } = await b
      .from("profiles")
      .select("full_name")
      .eq("id", clerkId)
      .maybeSingle();
    assert.equal(row.full_name, "Cleo Clerk", "a refused write must leave the name alone");
  });

  await test("the function takes no id — it cannot touch another person's row", async () => {
    // There is no id parameter to pass, which is the guarantee. Assert that
    // renaming as the clerk moves the clerk and never the admin.
    await clerkClient.rpc("fn_update_my_profile", { p_full_name: "Only Me" });

    const { data: boss } = await b
      .from("profiles")
      .select("full_name")
      .eq("id", adminId)
      .maybeSingle();
    assert.equal(boss.full_name, "Bea Boss", "the other profile must be untouched");
  });

  await test("renaming cannot change is_active or email", async () => {
    const before = await b
      .from("profiles")
      .select("is_active, email")
      .eq("id", clerkId)
      .maybeSingle();

    await clerkClient.rpc("fn_update_my_profile", { p_full_name: "Cleo Clerk" });

    const after = await b
      .from("profiles")
      .select("is_active, email")
      .eq("id", clerkId)
      .maybeSingle();
    assert.equal(after.data.is_active, before.data.is_active, "is_active is not the caller's");
    assert.equal(after.data.email, before.data.email, "email is not the caller's");
  });

  await test("a direct UPDATE on profiles is still refused for non-admins", async () => {
    // profiles_admin_update is the only UPDATE policy and stays that way — the
    // function exists precisely so this hole never had to be opened. RLS makes
    // the row invisible to the UPDATE rather than erroring, so assert on the
    // stored value, not on `error`.
    await clerkClient.from("profiles").update({ is_active: false }).eq("id", clerkId);

    const { data: row } = await b
      .from("profiles")
      .select("is_active")
      .eq("id", clerkId)
      .maybeSingle();
    assert.equal(row.is_active, true, "front desk must not be able to write their own row");
  });

  await test("a deactivated user cannot rename themselves", async () => {
    await b.from("profiles").update({ is_active: false }).eq("id", clerkId);

    const { error } = await clerkClient.rpc("fn_update_my_profile", {
      p_full_name: "Sneaky Rename",
    });
    assert.ok(error, "fn_is_active_user must gate the write");

    const { data: row } = await b
      .from("profiles")
      .select("full_name")
      .eq("id", clerkId)
      .maybeSingle();
    assert.equal(row.full_name, "Cleo Clerk", "the name must be unchanged");

    await b.from("profiles").update({ is_active: true }).eq("id", clerkId);
  });

  await test("admins rename themselves through the same function", async () => {
    const { data, error } = await adminClient.rpc("fn_update_my_profile", {
      p_full_name: "Bea Boss-Santos",
    });
    assert.equal(error, null);
    assert.equal(data.full_name, "Bea Boss-Santos");
    assert.equal(data.id, adminId, "an admin still only gets their own row");
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
