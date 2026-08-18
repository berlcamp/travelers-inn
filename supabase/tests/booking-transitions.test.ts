// Pure unit tests for the moves a booking may make, and the words used to ask.
// Run with:
//   node --experimental-strip-types supabase/tests/booking-transitions.test.ts
//
// This table now drives TWO surfaces — the status dropdown on the /bookings
// column and the lifecycle buttons in the manage dialog — so most of these are
// about the invariants that keep those two honest: only moves the server
// actions actually accept are offered, and every offered move comes with a
// sentence naming what it costs.
import assert from "node:assert/strict";
import {
  allowedTransitions,
  transitionDescription,
  type TransitionContext,
  type TransitionTarget,
} from "../../src/features/bookings/booking-transitions.ts";

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

const ctx: TransitionContext = {
  guestName: "Ana Reyes",
  roomLabel: "103",
  checkInText: "Sat, Aug 22, 1:00 PM",
  checkOutText: "Sun, Aug 23, 12:00 noon",
};

const targets = (status: string) => allowedTransitions(status).map((t) => t.to);

console.log("booking-transitions");

// --- which moves exist ----------------------------------------------------

test("a confirmed booking can be checked in, no-showed or cancelled", () => {
  // Order matters: the ordinary next step first, then the two ways a stay
  // fails. Both surfaces render the list as it comes back.
  assert.deepEqual(targets("confirmed"), ["checked_in", "no_show", "cancelled"]);
});

test("a checked-in booking can only be checked out or cancelled", () => {
  // No no-show: the guest is demonstrably in the building.
  assert.deepEqual(targets("checked_in"), ["checked_out", "cancelled"]);
});

test("a booking awaiting deposit verification offers no moves", () => {
  // Confirming one needs the verified AMOUNT and rejecting one needs a reason
  // (verification-actions.ts). Neither is something a menu can ask for, so
  // both stay in the verification panel and this stays empty.
  assert.deepEqual(targets("pending_verification"), []);
});

test("a finished booking offers no moves", () => {
  for (const status of ["checked_out", "cancelled", "no_show"]) {
    assert.deepEqual(targets(status), [], status);
  }
});

test("an unknown status offers no moves", () => {
  // The opposite of booking-order.ts, which sorts an unknown status to the TOP
  // where it is a visible nuisance. Here a wrong guess would be a control that
  // answers with an error, so silence is the safer default.
  assert.deepEqual(targets("archived"), []);
  assert.deepEqual(targets(""), []);
});

test("every offered move is one the server actions can perform", () => {
  // apply-transition.ts maps exactly these four to a real action; anything
  // else would compile but bounce off `transition()`'s status precondition.
  const performable: TransitionTarget[] = ["checked_in", "checked_out", "no_show", "cancelled"];
  for (const status of ["pending_verification", "confirmed", "checked_in", "checked_out"]) {
    for (const t of allowedTransitions(status)) {
      assert.ok(performable.includes(t.to), `${status} → ${t.to}`);
    }
  }
});

test("no status offers the same move twice, or a move to itself", () => {
  for (const status of ["confirmed", "checked_in"]) {
    const list = targets(status);
    assert.equal(new Set(list).size, list.length, status);
    assert.ok(!list.includes(status as TransitionTarget), status);
  }
});

test("the returned list is a fresh array each call", () => {
  const first = allowedTransitions("confirmed");
  first.pop();
  assert.equal(allowedTransitions("confirmed").length, 3);
});

// --- how each move is labelled --------------------------------------------

test("every move carries a label, a confirm label, a title and a toast", () => {
  for (const status of ["confirmed", "checked_in"]) {
    for (const t of allowedTransitions(status)) {
      for (const field of ["label", "confirmLabel", "title", "success"] as const) {
        assert.ok(t[field].length > 0, `${t.to}.${field}`);
      }
    }
  }
});

test("no menu label is a bare 'Cancel'", () => {
  // A menu item reading "Cancel" is read as "dismiss this menu", not "cancel
  // this booking" — and the two are one tap apart on the same control.
  for (const status of ["confirmed", "checked_in"]) {
    for (const t of allowedTransitions(status)) {
      assert.notEqual(t.label.trim().toLowerCase(), "cancel", t.to);
    }
  }
});

test("only the two failure moves are destructive", () => {
  const destructive = new Set(
    ["confirmed", "checked_in"].flatMap((s) =>
      allowedTransitions(s)
        .filter((t) => t.destructive)
        .map((t) => t.to)
    )
  );
  assert.deepEqual([...destructive].sort(), ["cancelled", "no_show"]);
});

// --- what each modal says -------------------------------------------------

test("every description names the guest and the room", () => {
  for (const to of ["checked_in", "checked_out", "no_show", "cancelled"] as TransitionTarget[]) {
    const text = transitionDescription(to, ctx);
    assert.ok(text.includes("Ana Reyes"), to);
    assert.ok(text.includes("room 103"), to);
  }
});

test("an unassigned room reads as 'the room', never 'room '", () => {
  const text = transitionDescription("cancelled", { ...ctx, roomLabel: "" });
  assert.ok(text.includes("the room"));
  assert.ok(!text.includes("room ."));
  assert.ok(!/room\s{2}/.test(text));
});

test("checking in spells out the booked arrival", () => {
  // The same control is used on advance bookings — the availability page hands
  // the walk-in dialog a FUTURE window — so "check in" may well be for a stay
  // that starts next week.
  assert.ok(transitionDescription("checked_in", ctx).includes("Sat, Aug 22, 1:00 PM"));
});

test("checking out warns that the real time is recorded over the booked one", () => {
  const text = transitionDescription("checked_out", ctx);
  assert.ok(text.includes("recorded as now"));
  assert.ok(text.includes("Sun, Aug 23, 12:00 noon"));
});

test("cancelling says the money leaves revenue; a no-show says it stays", () => {
  // The one substantive difference between the two "didn't happen" endings:
  // a cancellation hands the money back, a no-show forfeits it
  // (analytics.countsAsRevenue).
  assert.ok(transitionDescription("cancelled", ctx).includes("out of revenue"));
  assert.ok(transitionDescription("no_show", ctx).includes("keeps anything already paid"));
});

test("every irreversible move says so", () => {
  for (const to of ["no_show", "cancelled"] as TransitionTarget[]) {
    assert.ok(transitionDescription(to, ctx).includes("cannot be undone"), to);
  }
});

console.log(`\n${passed} passed`);
