import type { BookingStatus } from "./schemas";
import type { BookingRow } from "./repository";
import type { RoomWithType } from "@/features/rooms/repository";
import {
  fromInnClock,
  innAddDays,
  innDateValue,
  innFormatter,
  innStartOfDay,
  innWeekday,
} from "@/lib/inn-time";

export type CalendarCell = {
  occupied: boolean;
  guestName?: string;
  status?: BookingStatus;
  isStart?: boolean;
};

export type CalendarRow = {
  roomId: string;
  label: string;
  typeName: string;
  cells: CalendarCell[];
};

export type CalendarData = {
  startISO: string;
  prevISO: string;
  nextISO: string;
  days: { weekday: string; day: string; isWeekend: boolean }[];
  rows: CalendarRow[];
};

// Bookings that count as occupying a room on the calendar. A pending_verification
// booking already holds its room (the DB exclusion constraint blocks a second
// booking over the same window), so it must render as occupied too.
const ACTIVE: BookingStatus[] = ["pending_verification", "confirmed", "checked_in", "checked_out"];

const weekdayFmt = innFormatter({ weekday: "short" });
const dayFmt = innFormatter({ day: "numeric", month: "short" });

// Every day boundary on this grid is a day at the INN — see src/lib/inn-time.ts.
// Read off the server's clock the columns would start at 8 AM Manila, and a
// stay would paint into the wrong cell.
const addDays = innAddDays;
const isoDate = innDateValue;

// Builds a rooms × days occupancy grid over `days` days starting at `startISO`
// (local wall-clock). A room-day is occupied when an active booking on that
// room overlaps [dayStart, nextDayStart).
export function buildCalendar(
  startISO: string,
  days: number,
  rooms: RoomWithType[],
  bookings: BookingRow[]
): CalendarData {
  const start = startISO ? fromInnClock(startISO) : innStartOfDay(new Date());
  const dayStarts = Array.from({ length: days }, (_, i) => addDays(start, i));

  const dayHeaders = dayStarts.map((d) => {
    // Day-of-week at the inn, not where this runs: getDay() on a UTC server
    // flips a Sunday column to Saturday for the whole evening.
    const dow = innWeekday(d);
    return {
      weekday: weekdayFmt.format(d),
      day: dayFmt.format(d),
      isWeekend: dow === 0 || dow === 6,
    };
  });

  const active = bookings.filter((b) => ACTIVE.includes(b.status as BookingStatus));

  const rows: CalendarRow[] = rooms.map((room) => {
    const roomBookings = active.filter((b) => b.room_id === room.id);
    const cells: CalendarCell[] = dayStarts.map((dayStart) => {
      const dayEnd = addDays(dayStart, 1);
      const hit = roomBookings.find((b) => {
        const ci = new Date(b.checkIn);
        const co = new Date(b.checkOut);
        return co > dayStart && ci < dayEnd;
      });
      if (!hit) return { occupied: false };
      const ci = new Date(hit.checkIn);
      const isStart = (ci >= dayStart && ci < dayEnd) || ci < start;
      return {
        occupied: true,
        guestName: hit.guest_name,
        status: hit.status as BookingStatus,
        // Only label the first visible day of a run so the bar reads cleanly.
        isStart:
          isStart && (dayStart.getTime() === start.getTime() || (ci >= dayStart && ci < dayEnd)),
      };
    });
    return { roomId: room.id, label: room.label, typeName: room.room_type?.name ?? "", cells };
  });

  return {
    startISO: isoDate(start),
    prevISO: isoDate(addDays(start, -days)),
    nextISO: isoDate(addDays(start, days)),
    days: dayHeaders,
    rows,
  };
}
