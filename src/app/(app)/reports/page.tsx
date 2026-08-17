import type { Metadata } from "next";
import { BedDouble, CalendarCheck, Coins, Percent, TrendingUp, Wallet } from "lucide-react";
import { pageRole } from "@/lib/auth/guards";
import { AccessDenied } from "@/components/shared/access-denied";
import { getReportData, getReportFilterOptions } from "@/features/reports/repository";
import { isoDate } from "@/features/reports/analytics";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { TrendBars } from "@/features/reports/components/trend-bars";
import { ReportRange } from "@/features/reports/components/report-range";
import { ExportButtons } from "@/features/reports/components/export-buttons";
import { BreakdownTable } from "@/features/reports/components/breakdown-table";
import {
  BookingsLedger,
  PaymentsLedger,
  METHOD_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
} from "@/features/reports/components/ledger-tables";
import { peso } from "@/features/bookings/pricing";
import { fromInnClock, innFormatter, innParts, innTime } from "@/lib/inn-time";

export const metadata: Metadata = { title: "Reports" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fullDate = innFormatter({
  month: "long",
  day: "numeric",
  year: "numeric",
});

// Defaults to the current month to date — the range an owner asks for most.
function resolveRange(from?: string, to?: string): { from: string; to: string } {
  // "This month" is the month at the inn — on the UTC server the 1st does not
  // begin until 8 AM Manila. See src/lib/inn-time.ts.
  const today = new Date();
  const monthStart = innTime(innParts(today).year, innParts(today).month, 1);
  const a = from && DATE_RE.test(from) ? from : isoDate(monthStart);
  const b = to && DATE_RE.test(to) ? to : isoDate(today);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; roomType?: string; staff?: string }>;
}) {
  const allowed = await pageRole(["admin"]);
  if (!allowed) return <AccessDenied requires={["admin"]} />;
  const params = await searchParams;
  const { from, to } = resolveRange(params.from, params.to);
  const options = await getReportFilterOptions();

  // An id in the URL that names nothing (a deleted room type, a hand-typed
  // param) is dropped rather than reported as an empty inn: the picker would
  // show "All room types" while every figure read zero.
  const roomTypeId = options.roomTypes.some((t) => t.id === params.roomType)
    ? (params.roomType ?? null)
    : null;
  const staffId = options.staff.some((s) => s.id === params.staff) ? (params.staff ?? null) : null;

  const data = await getReportData(from, to, { roomTypeId, staffId });
  const f = data.financial;
  const b = data.bookings;

  const roomTypeName = options.roomTypes.find((t) => t.id === roomTypeId)?.name ?? null;
  const staffName = options.staff.find((s) => s.id === staffId)?.name ?? null;
  const scope = [roomTypeName, staffName].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={
          `${fullDate.format(fromInnClock(from))} – ` +
          `${fullDate.format(fromInnClock(to))}${scope ? ` · ${scope}` : ""}`
        }
        actions={<ExportButtons payments={f.payments} bookings={b.taken} from={from} to={to} />}
      />

      <ReportRange
        from={from}
        to={to}
        roomTypeId={roomTypeId}
        staffId={staffId}
        options={options}
      />

      {/* ---- Financial ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">
          Financial
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Collected"
            value={peso.format(f.collected)}
            icon={Coins}
            // Money taken back out by a cancellation is named rather than left
            // as an unexplained gap between this figure and the day's takings.
            hint={
              f.cancelledExcluded.count > 0
                ? `${f.paymentCount} payment${f.paymentCount === 1 ? "" : "s"} · ` +
                  `${peso.format(f.cancelledExcluded.amount)} refunded on cancellations, excluded`
                : `${f.paymentCount} payment${f.paymentCount === 1 ? "" : "s"} received`
            }
          />
          <StatCard
            label="Booked revenue"
            value={peso.format(f.bookedRevenue)}
            icon={TrendingUp}
            hint="Value of bookings taken in range"
          />
          <StatCard
            label="Outstanding"
            value={peso.format(f.outstanding)}
            icon={Wallet}
            hint="Unpaid balance, active stays (as of now)"
          />
          <StatCard
            label="Average payment"
            value={peso.format(f.averagePayment)}
            icon={Coins}
            hint={
              f.voidedValue > 0
                ? `${peso.format(f.voidedValue)} cancelled / no-show`
                : "Per payment received"
            }
          />
        </div>

        <SectionCard title="Collections by day">
          <TrendBars
            points={f.daily.map((d) => ({ label: d.label, value: d.value, max: d.max }))}
            format="peso"
          />
        </SectionCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="By payment mode">
            <BreakdownTable
              buckets={f.byMethod}
              countLabel="Payments"
              labelOf={(bucket) => METHOD_LABEL(bucket.key)}
              emptyText="No payments received in this range."
            />
          </SectionCard>
          <SectionCard title="Collected by staff">
            <BreakdownTable
              buckets={f.byStaff}
              countLabel="Payments"
              emptyText="No payments received in this range."
            />
          </SectionCard>
        </div>

        <SectionCard title="Payments received" contentClassName="px-0 pt-0">
          <PaymentsLedger payments={f.payments} />
        </SectionCard>
      </section>

      {/* ---- Bookings ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">
          Bookings
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Bookings taken"
            value={b.totalTaken}
            icon={CalendarCheck}
            hint={`${b.guests} guest${b.guests === 1 ? "" : "s"}, cancellations excluded`}
          />
          <StatCard
            label="Room-nights sold"
            value={b.roomNights}
            icon={BedDouble}
            hint={`of ${b.availableRoomNights} available`}
          />
          <StatCard
            label="Occupancy"
            value={`${b.occupancyPct}%`}
            icon={Percent}
            // With a receptionist selected this is no longer inn occupancy —
            // the numerator is only the nights that person sold, so it reads
            // as their share of capacity. Say so rather than let it look like
            // the inn half-emptied.
            hint={
              staffName
                ? `Share of capacity sold by ${staffName}`
                : `${data.roomsTotal} ${roomTypeName ?? "room"}${
                    data.roomsTotal === 1 ? "" : "s"
                  } in service`
            }
          />
          <StatCard
            label="Average nightly rate"
            value={peso.format(b.adr)}
            icon={TrendingUp}
            hint="Stay value ÷ room-nights"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="By status">
            <BreakdownTable
              buckets={b.byStatus}
              countLabel="Bookings"
              labelOf={(bucket) => STATUS_LABEL(bucket.key)}
              emptyText="No bookings taken in this range."
            />
          </SectionCard>
          <SectionCard title="By channel">
            <BreakdownTable
              buckets={b.bySource}
              countLabel="Bookings"
              labelOf={(bucket) => SOURCE_LABEL(bucket.key)}
              emptyText="No bookings taken in this range."
            />
          </SectionCard>
          <SectionCard title="By room type">
            <BreakdownTable
              buckets={b.byRoomType}
              countLabel="Bookings"
              emptyText="No bookings taken in this range."
            />
          </SectionCard>
          <SectionCard title="Staff handling" contentClassName="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-muted-foreground text-xs">Bookings taken</span>
              <BreakdownTable
                buckets={b.byStaff}
                countLabel="Bookings"
                emptyText="No bookings taken in this range."
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-muted-foreground text-xs">Deposits verified</span>
              <BreakdownTable
                buckets={b.verifiedByStaff}
                countLabel="Verified"
                emptyText="No deposits verified in this range."
              />
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Bookings taken" contentClassName="px-0 pt-0">
          <BookingsLedger bookings={b.taken} />
        </SectionCard>
      </section>
    </div>
  );
}
