// The up-front portion a portal guest pays. Kept pure and separately tested
// because it decides how much money changes hands — the server recomputes it
// from the authoritative quoted_total rather than trusting the client.
export function depositFor(total: number, percent: number): number {
  if (!(total > 0)) return 0;
  const pct = Math.min(100, Math.max(0, percent));
  return Math.round(total * pct) / 100;
}
