// ============================================================================
// The inn's clock.
//
// Every wall-clock time in this app — "check in at 8pm", "due out at noon",
// "today's revenue", "14:00 → next 12:00 is one night" — means a time on the
// clock hanging on the wall AT THE INN. That clock is Asia/Manila and nothing
// else, so it is named here instead of being inherited from whatever machine
// happens to run the code.
//
// It used to be inherited, and that was a real bug: a walk-in booked for
// "Aug 17, 8:17 PM" was stored as 20:17 UTC — 4:17 AM the next day in Manila —
// because `new Date("2026-08-17T20:17")` reads a zoneless string in the
// PROCESS's zone, which is Asia/Manila on a laptop in Bayugan and UTC on the
// deployed server. The code was correct in dev and eight hours wrong in
// production, which is the worst way for a bug to behave. Same for
// `setHours(12)` (noon check-out became 8 PM), `setHours(14)`/`setHours(0)`
// (the reporting "day" ran 8 AM → 8 AM), and every default the forms prefill.
//
// So: no function in this app may call setHours/getHours/getDate on a Date it
// intends as inn time, and no zoneless string may be handed to `new Date()`.
// Route it through here. Display goes through innFormatter() for the same
// reason — a phone with its timezone set to Singapore should still show the
// guest the hour the front desk will read out.
//
// Pure and import-free, so the modules that unit-test under
// `node --experimental-strip-types` can import it (relatively, with the .ts
// extension — see supabase/tests/*.ts).
// ============================================================================

export const INN_TIME_ZONE = "Asia/Manila";

export type InnParts = {
  year: number;
  month: number; // 1-12, like a human reads it — NOT the 0-11 Date uses
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: INN_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** What the inn's clock reads at this instant. */
export function innParts(d: Date): InnParts {
  const parts = PARTS_FORMAT.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Milliseconds the inn's clock runs ahead of UTC at this instant (+8h). Read
 *  off the zone database rather than hardcoded: the Philippines has had no DST
 *  since 1978, but a hardcoded +08:00 is a fact about 1978 rather than a fact
 *  about the zone, and this is the one place that would silently rot. */
function offsetMsAt(instant: number): number {
  const p = innParts(new Date(instant));
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant;
}

/** An instant from a reading of the inn's clock. */
export function innTime(
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes: the offset is looked up at an instant, but the instant is what
  // we're solving for. The first pass lands within an hour of the answer, which
  // is close enough for the second to read the right offset. (With a fixed
  // offset both passes agree immediately; the second only earns its keep on a
  // DST boundary, and costs nothing.)
  const first = asIfUtc - offsetMsAt(asIfUtc);
  return new Date(asIfUtc - offsetMsAt(first));
}

/** Parse what the forms speak — "YYYY-MM-DD", "YYYY-MM-DDTHH:mm" or
 *  "YYYY-MM-DDTHH:mm:ss" — as INN wall-clock, whatever zone the process is in.
 *  A string that already carries a zone (…Z, …+08:00) is absolute and is left
 *  alone: it isn't a clock reading, it's an instant. */
export function fromInnClock(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local.trim());
  if (!m) return new Date(local);
  return innTime(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0)
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" on the inn's clock — the value a `type="date"` input speaks,
 *  and the key the report ranges use. */
export function innDateValue(d: Date): string {
  const p = innParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:mm" on the inn's clock — what `type="datetime-local"`
 *  speaks. Round-trips through fromInnClock(). */
export function innClockValue(d: Date): string {
  const p = innParts(d);
  return `${innDateValue(d)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Midnight at the inn on the day this instant falls in. */
export function innStartOfDay(d: Date): Date {
  return innAtHour(d, 0);
}

/** The given hour of the inn's clock, on the day this instant falls in. */
export function innAtHour(d: Date, hour: number, minute = 0): Date {
  const p = innParts(d);
  return innTime(p.year, p.month, p.day, hour, minute, 0);
}

/** n days later on the inn's CALENDAR (not +n×24h — same wall-clock time on a
 *  later date, which is what "tomorrow at noon" means). */
export function innAddDays(d: Date, n: number): Date {
  const p = innParts(d);
  return innTime(p.year, p.month, p.day + n, p.hour, p.minute, p.second);
}

/** The hour the inn's clock reads. */
export function innHour(d: Date): number {
  return innParts(d).hour;
}

/** Day of the week at the inn, 0 = Sunday, matching Date.getDay(). */
export function innWeekday(d: Date): number {
  const p = innParts(d);
  // Date.UTC + getUTCDay() rather than getDay(): the calendar day is already
  // the inn's, so the weekday must be read back without a second zone shift.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Same date on the inn's calendar. */
export function innSameDay(a: Date, b: Date): boolean {
  return innDateValue(a) === innDateValue(b);
}

/** A formatter pinned to the inn's clock. Use this instead of
 *  `new Intl.DateTimeFormat(...)` for anything that is a time AT THE INN, so
 *  the hour on screen is the hour the front desk will say out loud regardless
 *  of where the viewer's device thinks it is. */
export function innFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-PH", { timeZone: INN_TIME_ZONE, ...options });
}
