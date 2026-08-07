// Pure unit test for roleMatches — the one predicate behind BOTH the sidebar's
// filtering and every page's `pageRole` guard. Run with:
//   node --experimental-strip-types supabase/tests/roles.test.ts
//
// The reason this is worth testing on its own: when the menu and the guard
// disagree, the symptom is a visible link that refuses to open — which is
// exactly the bug that put an "Availability" item in front of users the page
// then rejected with a 500.
import assert from "node:assert/strict";
import { roleMatches, ROLE_LABELS } from "../../src/lib/auth/roles.ts";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("roleMatches");

test("admin passes every check, including ones it isn't named in", () => {
  assert.equal(roleMatches(["admin"], ["admin"]), true);
  assert.equal(roleMatches(["admin"], ["front_desk"]), true);
  assert.equal(roleMatches(["admin"], ["admin", "front_desk"]), true);
});

test("front desk passes only what it is named in", () => {
  assert.equal(roleMatches(["front_desk"], ["front_desk"]), true);
  assert.equal(roleMatches(["front_desk"], ["admin", "front_desk"]), true);
  assert.equal(roleMatches(["front_desk"], ["admin"]), false);
});

test("a user with no role passes nothing", () => {
  // The case that produced the 500: a profile exists, roles do not.
  assert.equal(roleMatches([], ["admin"]), false);
  assert.equal(roleMatches([], ["front_desk"]), false);
  assert.equal(roleMatches([], ["admin", "front_desk"]), false);
});

test("an empty allow-list denies everyone except admin", () => {
  // Admin's blanket pass is checked before the list, so it survives; nobody
  // else can match an empty list. Pages always pass a non-empty list, so this
  // pins the behaviour rather than describing a route that exists.
  assert.equal(roleMatches(["front_desk"], []), false);
  assert.equal(roleMatches([], []), false);
  assert.equal(roleMatches(["admin"], []), true);
});

test("multiple roles are OR-ed, not AND-ed", () => {
  assert.equal(roleMatches(["front_desk", "admin"], ["admin"]), true);
  assert.equal(roleMatches(["front_desk"], ["admin", "front_desk"]), true);
});

test("every role has a label — the access-denied panel prints these", () => {
  for (const role of ["admin", "front_desk"] as const) {
    assert.equal(typeof ROLE_LABELS[role], "string");
    assert.ok(ROLE_LABELS[role].length > 0, `${role} needs a human-readable label`);
  }
});

if (process.exitCode) {
  console.error(`\n${passed} passed, with failures.`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
