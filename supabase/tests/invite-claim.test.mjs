// Integration test for booking.fn_claim_invitation() against the real local
// stack. Covers: first-user admin bootstrap, uninvited rejection, and an
// invited front_desk claim.
//
// Run: npm run db:start && node supabase/tests/invite-claim.test.mjs
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

async function main() {
  console.log("fn_claim_invitation");
  await resetIdentity();
  const b = adminBooking();

  // (a) First-ever user, no invitation → bootstrap as admin.
  await test("first user with no invitation is bootstrapped as admin", async () => {
    const id = await createUser("owner@test.local", "Olivia Owner");
    const client = await clientAs("owner@test.local");
    const { data: claimed, error } = await client.rpc("fn_claim_invitation");
    assert.equal(error, null, error?.message);
    assert.equal(claimed, true, "claim should return true");

    const { data: profile } = await b.from("profiles").select("id, full_name").eq("id", id).maybeSingle();
    assert.ok(profile, "profile should be provisioned");
    assert.equal(profile.full_name, "Olivia Owner");

    const { data: roles } = await b.from("user_roles").select("role").eq("user_id", id);
    assert.deepEqual(
      roles.map((r) => r.role),
      ["admin"],
      "first user should get the admin role"
    );
  });

  // (b) Second user, no invitation, profiles now non-empty → rejected.
  await test("uninvited user (not first) is rejected", async () => {
    const id = await createUser("stranger@test.local", "Sam Stranger");
    const client = await clientAs("stranger@test.local");
    const { data: claimed } = await client.rpc("fn_claim_invitation");
    assert.equal(claimed, false, "claim should return false");

    const { data: profile } = await b.from("profiles").select("id").eq("id", id).maybeSingle();
    assert.equal(profile, null, "no profile should be provisioned");
  });

  // (c) Invited front_desk email → claimed with the invited role.
  await test("invited user claims their invited role and marks invite accepted", async () => {
    const { data: inv, error: invErr } = await b
      .from("invitations")
      .insert({ email: "desk@test.local", role: "front_desk" })
      .select("id")
      .single();
    assert.equal(invErr, null, invErr?.message);

    const id = await createUser("desk@test.local", "Dana Desk");
    const client = await clientAs("desk@test.local");
    const { data: claimed } = await client.rpc("fn_claim_invitation");
    assert.equal(claimed, true, "claim should return true");

    const { data: roles } = await b.from("user_roles").select("role").eq("user_id", id);
    assert.deepEqual(
      roles.map((r) => r.role),
      ["front_desk"],
      "should get the invited front_desk role"
    );

    const { data: after } = await b
      .from("invitations")
      .select("status, accepted_at")
      .eq("id", inv.id)
      .single();
    assert.equal(after.status, "accepted", "invitation should be marked accepted");
    assert.ok(after.accepted_at, "accepted_at should be set");
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
