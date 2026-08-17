// The regression harness for the timezone bug. Run with:
//   node supabase/tests/timezone-independence.mjs      (or: npm run test:tz)
//
// Every pure suite is run again under several TZ values. This is the test that
// would have caught the original defect: the code read wall-clock times in the
// PROCESS's zone, so it was correct on a laptop in Bayugan and eight hours
// wrong on the UTC server — and every existing test passed, because they all
// ran on the laptop. A suite that passes under Asia/Manila and fails under UTC
// is a suite that is measuring the machine rather than the inn.
//
// UTC is what the deployed server actually runs as. America/New_York is on the
// other side of the date line from Manila, so anything that leaks a local
// calendar day shows up as an off-by-one date. Pacific/Kiritimati is +14, ahead
// of Manila, which catches the opposite sign. Australia/Lord_Howe has a 30-
// minute offset AND DST, so a helper that assumes whole-hour offsets breaks
// here rather than in production some October.
//
// No DB — these are the pure modules only. The .mjs suites talk to Postgres,
// which stores absolute instants and is not affected.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const ZONES = [
  "UTC",
  "Asia/Manila",
  "America/New_York",
  "Pacific/Kiritimati",
  "Australia/Lord_Howe",
];

const SUITES = [
  "inn-time.test.ts",
  "pricing.test.ts",
  "reports.test.ts",
  "analytics.test.ts",
  "collections.test.ts",
  "occupancy.test.ts",
  "stay-window.test.ts",
  "deposit.test.ts",
  "roles.test.ts",
  "og-image.test.ts",
];

let failed = 0;

for (const TZ of ZONES) {
  const broken = [];
  for (const suite of SUITES) {
    try {
      execFileSync(process.execPath, ["--experimental-strip-types", join(here, suite)], {
        env: { ...process.env, TZ },
        stdio: "pipe",
      });
    } catch {
      broken.push(suite);
    }
  }
  if (broken.length === 0) {
    console.log(`  ✓ TZ=${TZ} — all ${SUITES.length} pure suites pass`);
  } else {
    failed += broken.length;
    console.error(`  ✗ TZ=${TZ} — ${broken.join(", ")}`);
    console.error(
      `     Re-run one to see why:  TZ=${TZ} node --experimental-strip-types supabase/tests/${broken[0]}`
    );
  }
}

if (failed) {
  console.error(
    `\n${failed} suite/zone combinations failed. Something is reading the process's clock` +
      ` instead of the inn's — see src/lib/inn-time.ts.`
  );
  process.exitCode = 1;
} else {
  console.log(`\nAll ${SUITES.length} pure suites pass in all ${ZONES.length} timezones.`);
}
