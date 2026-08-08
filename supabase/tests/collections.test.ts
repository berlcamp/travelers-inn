// Pure unit tests for the Collections (remittance) maths. Run with:
//   node --experimental-strip-types supabase/tests/collections.test.ts
// No DB — computeCollectionsReport is pure. Relative imports (no @/ alias).
//
// Timestamps are built from LOCAL date parts via at(), because the report range
// is local ("6 Aug" means midnight in the inn's timezone). Literal UTC strings
// would make these pass or fail depending on the machine's clock.
import assert from "node:assert/strict";
import {
  computeCollectionsReport,
  isCashMethod,
  type ReportPayment,
} from "../../src/features/reports/analytics.ts";

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

function at(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

function payment(over: Partial<ReportPayment> = {}): ReportPayment {
  return {
    id: "p1",
    bookingId: "b1",
    bookingRef: "TI-000001",
    guestName: "Guest",
    amount: 500,
    method: "cash",
    reference: null,
    createdAt: at(2026, 8, 6, 15),
    recordedBy: "dana",
    recordedByName: "Dana Desk",
    ...over,
  };
}

const DAY = { from: "2026-08-06", to: "2026-08-06" };
const NO_FILTERS = { staffId: null };

console.log("collections report");

// ---- the cash/non-cash split ------------------------------------------------

test("only cash counts as cash to remit", () => {
  assert.equal(isCashMethod("cash"), true);
  for (const m of ["gcash", "card", "bank_transfer", "other"]) {
    assert.equal(isCashMethod(m), false, `${m} is already in an account`);
  }
});

test("cash and non-cash are split, and together make the total", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [
      payment({ id: "a", amount: 1000, method: "cash" }),
      payment({ id: "b", amount: 250, method: "gcash" }),
      payment({ id: "c", amount: 400, method: "cash" }),
      payment({ id: "d", amount: 350, method: "bank_transfer" }),
    ],
    filters: NO_FILTERS,
  });
  assert.equal(r.cash, 1400, "only the two cash payments");
  assert.equal(r.nonCash, 600);
  assert.equal(r.total, 2000);
  assert.equal(r.count, 4);
});

// ---- attribution ------------------------------------------------------------

test("a receptionist's sheet holds what THEY received, not what they sold", () => {
  // Dana books the guest; Ray collects the balance on check-out. The money is
  // in Ray's drawer, so it must appear on Ray's sheet and not on Dana's.
  const payments = [
    payment({ id: "deposit", amount: 500, recordedBy: "dana", recordedByName: "Dana Desk" }),
    payment({ id: "balance", amount: 1500, recordedBy: "ray", recordedByName: "Ray Night" }),
  ];
  const ray = computeCollectionsReport({
    ...DAY,
    payments,
    filters: { staffId: "ray" },
  });
  assert.equal(ray.total, 1500);
  assert.deepEqual(
    ray.payments.map((p) => p.id),
    ["balance"]
  );
});

test("an unattributed payment gets its own line rather than vanishing", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [
      payment({ id: "a", amount: 300, recordedBy: null, recordedByName: null }),
      payment({ id: "b", amount: 700 }),
    ],
    filters: NO_FILTERS,
  });
  assert.equal(r.total, 1000, "the orphan payment still counts toward the total");
  const orphan = r.byStaff.find((b) => b.key === "unattributed");
  assert.ok(orphan, "an unattributed bucket exists");
  assert.equal(orphan.amount, 300);
});

test("by-staff and by-method buckets each add up to the total", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [
      payment({ id: "a", amount: 1000, method: "cash", recordedBy: "dana" }),
      payment({ id: "b", amount: 250, method: "gcash", recordedBy: "ray" }),
      payment({ id: "c", amount: 400, method: "cash", recordedBy: "ray" }),
    ],
    filters: NO_FILTERS,
  });
  assert.equal(
    r.byStaff.reduce((a, b) => a + b.amount, 0),
    r.total
  );
  assert.equal(
    r.byMethod.reduce((a, b) => a + b.amount, 0),
    r.total
  );
  assert.equal(r.byMethod.find((b) => b.key === "cash")?.count, 2);
});

// ---- the range --------------------------------------------------------------

test("a payment taken just before midnight is in that day's sheet", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [payment({ createdAt: at(2026, 8, 6, 23, 59) })],
    filters: NO_FILTERS,
  });
  assert.equal(r.count, 1, "the range must include the whole of the 6th");
});

test("a payment on the next day is not", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [payment({ createdAt: at(2026, 8, 7, 0, 1) })],
    filters: NO_FILTERS,
  });
  assert.equal(r.count, 0);
  assert.equal(r.total, 0);
});

test("a multi-day range reports every day, including the empty ones", () => {
  const r = computeCollectionsReport({
    from: "2026-08-06",
    to: "2026-08-08",
    payments: [
      payment({ id: "a", amount: 600, method: "cash", createdAt: at(2026, 8, 6, 9) }),
      payment({ id: "b", amount: 400, method: "gcash", createdAt: at(2026, 8, 8, 20) }),
    ],
    filters: NO_FILTERS,
  });
  assert.equal(r.daily.length, 3);
  assert.deepEqual(
    r.daily.map((d) => d.total),
    [600, 0, 400],
    "the 7th collected nothing and must still be shown"
  );
  assert.equal(r.daily[0].cash, 600);
  assert.equal(r.daily[2].cash, 0, "GCash is not cash");
  assert.equal(r.daily[2].nonCash, 400);
});

// ---- ordering ---------------------------------------------------------------

test("transactions read oldest first — the order the shift happened", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [
      payment({ id: "late", createdAt: at(2026, 8, 6, 22) }),
      payment({ id: "early", createdAt: at(2026, 8, 6, 8) }),
      payment({ id: "noon", createdAt: at(2026, 8, 6, 12) }),
    ],
    filters: NO_FILTERS,
  });
  assert.deepEqual(
    r.payments.map((p) => p.id),
    ["early", "noon", "late"]
  );
});

test("the staff filter narrows every figure, not just the list", () => {
  const r = computeCollectionsReport({
    ...DAY,
    payments: [
      payment({ id: "a", amount: 1000, method: "cash", recordedBy: "dana" }),
      payment({ id: "b", amount: 250, method: "gcash", recordedBy: "ray" }),
    ],
    filters: { staffId: "ray" },
  });
  assert.equal(r.count, 1);
  assert.equal(r.total, 250);
  assert.equal(r.cash, 0, "Ray took no cash, so he has none to hand over");
  assert.equal(r.nonCash, 250);
  assert.equal(r.daily[0].total, 250, "the day totals follow the filter too");
});

test("an empty range is zeroes, not NaN", () => {
  const r = computeCollectionsReport({ ...DAY, payments: [], filters: NO_FILTERS });
  assert.deepEqual(
    { total: r.total, cash: r.cash, nonCash: r.nonCash, count: r.count },
    { total: 0, cash: 0, nonCash: 0, count: 0 }
  );
  assert.deepEqual(r.byMethod, []);
  assert.equal(r.daily.length, 1);
});

if (process.exitCode) {
  console.error(`\n${passed} passed, with failures.`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
