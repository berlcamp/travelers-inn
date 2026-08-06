// CSV serialisation for report exports. Pure and unit-tested — an export that
// silently mangles a guest name or an amount is worse than no export.

export type CsvValue = string | number | null | undefined;

// Excel and Sheets treat a leading =, +, -, or @ as a formula, which turns a
// guest name like "=cmd" into executable content in someone else's spreadsheet.
// Prefixing with an apostrophe keeps the text visible and inert.
function neutralize(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "number" ? String(value) : neutralize(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\r\n");
}
