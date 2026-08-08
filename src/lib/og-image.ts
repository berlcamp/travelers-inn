/**
 * Social-card images.
 *
 * Facebook will not render a thumbnail on the FIRST scrape of a URL unless
 * `og:image:width` and `og:image:height` are declared — without them it has to
 * download and measure the file, which happens after the card has already been
 * drawn. For most sites that is invisible, because the same handful of URLs get
 * scraped once and cached. Not here: every shared room link carries the
 * sharer's own checkIn/checkOut, so essentially every share is a URL Facebook
 * has never seen, and every share is a first scrape.
 *
 * Room covers are guest-uploaded, so their dimensions aren't known ahead of
 * time and can't simply be hardcoded. Instead the cover is served through
 * Supabase Storage's image-transform endpoint at a fixed size, which makes the
 * dimensions knowable by construction — and gets the 1.91:1 ratio Facebook
 * crops to anyway, so the card frames what the photographer framed.
 */

/** Facebook's recommended card size. Anything else gets cropped by them. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type OgImage = {
  url: string;
  /** Omitted only when the size genuinely isn't knowable — see coverOgImage.
   *  Never emit a zero: Next would write `og:image:width 0`, which is worse
   *  than saying nothing. */
  width?: number;
  height?: number;
  alt: string;
};

// The inn's own card, used when a room type has no photo yet. A static file in
// /public, so its true size is known and stated.
export function fallbackOgImage(alt = "Bañares Traveler's Inn"): OgImage {
  return { url: "/og-couple.jpg", width: 2048, height: 1536, alt };
}

// A Supabase public object URL, rewritten to the render endpoint. The two
// differ only in this path segment; everything else — project host, bucket,
// object key — is carried over untouched.
const PUBLIC_OBJECT = "/storage/v1/object/public/";
const RENDER_OBJECT = "/storage/v1/render/image/public/";

/**
 * A room cover as a card-sized image, or null when there is nothing usable.
 *
 * Anything that isn't a Supabase public object URL is returned as-is WITHOUT
 * dimensions rather than rewritten blindly — a hand-edited image_url pointing
 * somewhere else would otherwise be turned into a 404. Such a card falls back
 * to Facebook's measure-it-later path, which is exactly where we started, but
 * it is still better than a broken image.
 */
export function coverOgImage(imageUrl: string | null | undefined, alt: string): OgImage | null {
  const url = imageUrl?.trim();
  if (!url) return null;
  if (!url.includes(PUBLIC_OBJECT)) return { url, alt };

  const rendered = new URL(url.replace(PUBLIC_OBJECT, RENDER_OBJECT));
  rendered.searchParams.set("width", String(OG_WIDTH));
  rendered.searchParams.set("height", String(OG_HEIGHT));
  // `cover` fills the frame and crops the overflow; `contain` would letterbox a
  // 4:3 room photo with bars, which reads as a broken image in a feed.
  rendered.searchParams.set("resize", "cover");
  return { url: rendered.toString(), width: OG_WIDTH, height: OG_HEIGHT, alt };
}
