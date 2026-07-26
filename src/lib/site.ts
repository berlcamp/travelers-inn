// Deliberately hardcoded rather than read from NEXT_PUBLIC_APP_URL: that env
// var points at the Supabase project in production, which would make social
// crawlers fetch og-couple.jpg (and this QR target) from a host that 404s —
// no thumbnail on Facebook, and a scanned QR code that goes nowhere.
export const SITE_URL = "https://bti.kerisoftware.com";

// The URL encoded into each room's printed feedback QR code.
export function feedbackUrlFor(roomId: string): string {
  return `${SITE_URL}/feedback/${roomId}`;
}
