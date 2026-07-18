import type { BookingStatus } from "./schemas";
import type { BookingRow } from "./repository";
import type { RoomWithType } from "@/features/rooms/repository";

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

// Bookings that count as occupying a room on the calendar.
const ACTIVE: BookingStatus[] = ["confirmed", "checked_in", "checked_out"];

const weekdayFmt = new Intl.DateTimeFormat("en-PH", { weekday: "short" });
const dayFmt = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short" });

function atMidnight(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Builds a rooms × days occupancy grid over `days` days starting at `startISO`
// (local wall-clock). A room-day is occupied when an active booking on that
// room overlaps [dayStart, nextDayStart).
export function buildCalendar(
  startISO: string,
  days: number,
  rooms: RoomWithType[],
  bookings: BookingRow[]
): CalendarData {
  const start = atMidnight(startISO ? new Date(`${startISO}T00:00:00`) : new Date());
  const dayStarts = Array.from({ length: days }, (_, i) => addDays(start, i));

  const dayHeaders = dayStarts.map((d) => {
    const dow = d.getDay();
    return { weekday: weekdayFmt.format(d), day: dayFmt.format(d), isWeekend: dow === 0 || dow === 6 };
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
        isStart: isStart && (dayStart.getTime() === start.getTime() || (ci >= dayStart && ci < dayEnd)),
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
