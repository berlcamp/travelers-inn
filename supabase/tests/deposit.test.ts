// Pure unit test for the deposit calculation. Run with:
//   node --experimental-strip-types supabase/tests/deposit.test.ts
import assert from "node:assert/strict";
import { depositFor } from "../../src/features/bookings/deposit.ts";

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

console.log("depositFor()");

test("halves a round total", () => {
  assert.equal(depositFor(2000, 50), 1000);
});

test("rounds to two decimals", () => {
  assert.equal(depositFor(1250, 50), 625);
  assert.equal(depositFor(999.99, 50), 500);
});

test("handles a non-50 percentage", () => {
  assert.equal(depositFor(1000, 30), 300);
});

test("a zero total yields zero", () => {
  assert.equal(depositFor(0, 50), 0);
});

test("100 percent is the whole total", () => {
  assert.equal(depositFor(1500, 100), 1500);
});

test("clamps out-of-range percentages", () => {
  assert.equal(depositFor(1000, -10), 0);
  assert.equal(depositFor(1000, 150), 1000);
});

test("a negative total yields zero", () => {
  assert.equal(depositFor(-500, 50), 0);
});

console.log(`\n${passed} passed`);
