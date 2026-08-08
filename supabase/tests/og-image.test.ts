// Pure unit tests for the social-card image helper. Run with:
//   node --experimental-strip-types supabase/tests/og-image.test.ts
// No DB — lib/og-image.ts is pure string work. Relative imports (no @/ alias).
//
// This is URL surgery on a live storage path, which is exactly the kind of code
// that breaks silently: a wrong rewrite still produces a plausible-looking
// string, and the only symptom is a share card with no picture — days later,
// on someone else's Facebook feed.
import assert from "node:assert/strict";
import { coverOgImage, fallbackOgImage, OG_WIDTH, OG_HEIGHT } from "../../src/lib/og-image.ts";

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

const PUBLIC =
  "https://abcdefgh.supabase.co/storage/v1/object/public/travelers-inn-room-photos/photo.jpg";

console.log("og image");

test("a Supabase cover is rewritten to the render endpoint at card size", () => {
  const img = coverOgImage(PUBLIC, "Couple Room");
  assert.ok(img);
  const url = new URL(img.url);
  assert.equal(
    url.pathname,
    "/storage/v1/render/image/public/travelers-inn-room-photos/photo.jpg",
    "only the object segment changes — host, bucket and key are carried over"
  );
  assert.equal(url.searchParams.get("width"), String(OG_WIDTH));
  assert.equal(url.searchParams.get("height"), String(OG_HEIGHT));
  assert.equal(url.searchParams.get("resize"), "cover");
});

test("the declared dimensions match what the endpoint was asked for", () => {
  // The whole point: Facebook draws the thumbnail from these on a first scrape,
  // so they must be the size actually requested, not the original file's.
  const img = coverOgImage(PUBLIC, "Couple Room");
  assert.equal(img?.width, OG_WIDTH);
  assert.equal(img?.height, OG_HEIGHT);
  assert.equal(img?.alt, "Couple Room");
});

test("a card is 1.91:1 — the ratio Facebook crops to anyway", () => {
  assert.equal(Math.round((OG_WIDTH / OG_HEIGHT) * 100) / 100, 1.9);
});

test("a URL that is not a Supabase public object is left alone", () => {
  // Rewriting it blindly would turn a working image into a 404. It loses the
  // dimensions, which is only back to where we started — not worse.
  const img = coverOgImage("https://example.test/room.jpg", "Room");
  assert.equal(img?.url, "https://example.test/room.jpg");
  assert.equal(img?.width, undefined);
  assert.equal(img?.height, undefined);
});

test("no cover means no image, so the caller can fall back", () => {
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(coverOgImage(empty, "Room"), null, `${JSON.stringify(empty)} is not an image`);
  }
});

test("a zero dimension is never emitted", () => {
  // Next would write `og:image:width 0`, which is worse than saying nothing.
  const images = [coverOgImage(PUBLIC, "a"), coverOgImage("https://x.test/a.jpg", "b")];
  for (const img of images) {
    assert.notEqual(img?.width, 0);
    assert.notEqual(img?.height, 0);
  }
});

test("the fallback card states its own true size", () => {
  const img = fallbackOgImage();
  assert.equal(img.url, "/og-couple.jpg");
  assert.equal(img.width, 2048);
  assert.equal(img.height, 1536);
});

test("an existing query string on the cover is not duplicated", () => {
  const img = coverOgImage(`${PUBLIC}?width=99`, "Room");
  const url = new URL(img!.url);
  assert.deepEqual(url.searchParams.getAll("width"), [String(OG_WIDTH)], "set, not append");
});

if (process.exitCode) {
  console.error(`\n${passed} passed, with failures.`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
