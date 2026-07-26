// Deliberately hardcoded rather than read from NEXT_PUBLIC_APP_URL: that env
// var isn't reliably present at build time on every deploy target, and a wrong
// value here silently breaks share cards and printed QR codes.
export const SITE_URL = "https://bti.kerisoftware.com";

// The URL encoded into each room's printed feedback QR code.
export function feedbackUrlFor(roomId: string): string {
  return `${SITE_URL}/feedback/${roomId}`;
}
