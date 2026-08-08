// Deliberately hardcoded rather than read from NEXT_PUBLIC_APP_URL: that env
// var points at the Supabase project in production, which would make social
// crawlers fetch og-couple.jpg (and this QR target) from a host that 404s —
// no thumbnail on Facebook, and a scanned QR code that goes nowhere.
//
// This MUST be the domain guests actually see and share. The deployment also
// answers on bti.kerisoftware.com, and pointing this there was a real bug:
// `og:url` is what Facebook treats as canonical, so every share of a
// banarestravellersinn.com link was re-attributed to the other domain — likes
// and shares piled up on a URL nobody advertises, and the click-through walked
// the guest off the branded domain. The apex 308-redirects to www, so www is
// the address, not a variant of it.
export const SITE_URL = "https://www.banarestravellersinn.com";

// The URL encoded into each room's printed feedback QR code. Codes printed
// before this pointed at bti.kerisoftware.com; that host still serves the same
// app, so they keep working — only newly printed sheets change.
export function feedbackUrlFor(roomId: string): string {
  return `${SITE_URL}/feedback/${roomId}`;
}
