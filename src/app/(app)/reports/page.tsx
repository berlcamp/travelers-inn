import type { Metadata } from "next";
import { BedDouble, CalendarCheck, Coins, Percent, TrendingUp, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { getReportData } from "@/features/reports/repository";
import { isoDate } from "@/features/reports/analytics";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const metadata: Metadata = { title: "Reports" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fullDate = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

// Defaults to the current month to date — the range an owner asks for most.
function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const a = from && DATE_RE.test(from) ? from : isoDate(monthStart);
  const b = to && DATE_RE.test(to) ? to : isoDate(today);
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const { from, to } = resolveRange(params.from, params.to);
  const data = await getReportData(from, to);
  const f = data.financial;
  const b = data.bookings;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Reports"
        description={`${fullDate.format(new Date(`${from}T00:00:00`))} – ${fullDate.format(
          new Date(`${to}T00:00:00`)
        )}`}
        actions={<ExportButtons payments={f.payments} bookings={b.taken} from={from} to={to} />}
      />

      <ReportRange from={from} to={to} />

      {/* ---- Financial ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Financial</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Collected"
            value={peso.format(f.collected)}
            icon={Coins}
            hint={`${f.paymentCount} payment${f.paymentCount === 1 ? "" : "s"} received`}
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

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Collections by day</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBars
              points={f.daily.map((d) => ({ label: d.label, value: d.value, max: d.max }))}
              format="peso"
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By payment mode</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                buckets={f.byMethod}
                countLabel="Payments"
                labelOf={(bucket) => METHOD_LABEL(bucket.key)}
                emptyText="No payments received in this range."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Collected by staff</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                buckets={f.byStaff}
                countLabel="Payments"
                emptyText="No payments received in this range."
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payments received</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentsLedger payments={f.payments} />
          </CardContent>
        </Card>
      </section>

      {/* ---- Bookings ---- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Bookings</h2>
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
            hint={`${data.roomsTotal} room${data.roomsTotal === 1 ? "" : "s"} in service`}
          />
          <StatCard
            label="Average nightly rate"
            value={peso.format(b.adr)}
            icon={TrendingUp}
            hint="Stay value ÷ room-nights"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By status</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                buckets={b.byStatus}
                countLabel="Bookings"
                labelOf={(bucket) => STATUS_LABEL(bucket.key)}
                emptyText="No bookings taken in this range."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By channel</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                buckets={b.bySource}
                countLabel="Bookings"
                labelOf={(bucket) => SOURCE_LABEL(bucket.key)}
                emptyText="No bookings taken in this range."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">By room type</CardTitle>
            </CardHeader>
            <CardContent>
              <BreakdownTable
                buckets={b.byRoomType}
                countLabel="Bookings"
                emptyText="No bookings taken in this range."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Staff handling</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
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
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bookings taken</CardTitle>
          </CardHeader>
          <CardContent>
            <BookingsLedger bookings={b.taken} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
