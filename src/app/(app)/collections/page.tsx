import type { Metadata } from "next";
import { Banknote, Coins, Receipt, Smartphone } from "lucide-react";
import { pageRole, hasRole } from "@/lib/auth/guards";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { BreakdownTable } from "@/features/reports/components/breakdown-table";
import { METHOD_LABEL } from "@/features/reports/components/ledger-tables";
import { isoDate } from "@/features/reports/analytics";
import { getCollections } from "@/features/collections/repository";
import { CollectionsFilters } from "@/features/collections/components/collections-filters";
import { CollectionsLedger } from "@/features/collections/components/collections-ledger";
import { CollectionsExport } from "@/features/collections/components/collections-export";
import { PrintHeader, SignatureBlock } from "@/features/collections/components/remittance-slip";
import { peso } from "@/features/bookings/pricing";

export const metadata: Metadata = { title: "Collections" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fullDate = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * Defaults to TODAY, unlike /reports' month-to-date. A remittance sheet is a
 * shift's worth of money being counted out and handed over; opening on a month
 * would show a figure nobody is about to turn over.
 */
function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const today = isoDate(new Date());
  const a = from && DATE_RE.test(from) ? from : today;
  const b = to && DATE_RE.test(to) ? to : a;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await pageRole(["admin", "front_desk"]);
  if (!user) return <AccessDenied requires={["admin", "front_desk"]} />;

  const isAdmin = hasRole(user, "admin");
  const params = await searchParams;
  const { from, to } = resolveRange(params.from, params.to);

  // Who this sheet is for is decided by who is signed in, not by a control: a
  // receptionist always gets their OWN collections, an admin always gets the
  // whole desk. Nothing in the URL can change it, which is a stronger guarantee
  // than the validated `?staff=` this replaced.
  const staffId = isAdmin ? null : user.id;
  const report = await getCollections(from, to, { staffId });

  const staffName = isAdmin ? null : user.fullName || "You";
  const scope = staffName ?? "All receptionists";
  const period =
    from === to
      ? fullDate.format(new Date(`${from}T00:00:00`))
      : `${fullDate.format(new Date(`${from}T00:00:00`))} – ${fullDate.format(
          new Date(`${to}T00:00:00`)
        )}`;

  // With no staff filter the sheet spans several drawers, so the ledger has to
  // name who took each payment and the by-receptionist split is the point of
  // the page. Pinned to one person, both would just repeat their name.
  const allStaff = staffId === null;
  const singleDay = from === to;

  return (
    // `print-sheet` claims the bond-paper @page (see globals.css). On paper this
    // whole page collapses to three things: who/when, the transactions, and the
    // signatures — everything else is `print:hidden` below, because a screen
    // summary a clerk can read live is a second sheet nobody asked to carry.
    <div className="print-sheet flex flex-col gap-6 print:gap-0">
      <PageHeader
        className="print:hidden"
        title="Collections Report"
        description={`${period} · ${scope}`}
        actions={
          <CollectionsExport
            payments={report.payments}
            from={from}
            to={to}
            slug={(staffName ?? "all").toLowerCase().replace(/[^a-z0-9]+/g, "-")}
          />
        }
      />

      <PrintHeader period={period} scope={scope} printedAt={new Date()} />

      <CollectionsFilters from={from} to={to} />

      {/* Screen only. The two figures that matter on paper — cash and total —
          are restated beside the signatures, so printing these tiles too would
          spend a third of the sheet repeating them. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        {/* Cash leads: it is the only figure that has to be counted out by
            hand, and the one the two signatures at the bottom are about. */}
        <StatCard
          label="Cash to remit"
          value={peso.format(report.cash)}
          icon={Banknote}
          hint="Counted out and handed over"
        />
        <StatCard
          label="Non-cash"
          value={peso.format(report.nonCash)}
          icon={Smartphone}
          hint="GCash, card, bank — already in an account"
        />
        <StatCard
          label="Total collected"
          value={peso.format(report.total)}
          icon={Coins}
          // A cancellation hands the money back, so it leaves this figure. Say
          // so: an unexplained drop is how a clerk ends up recounting a drawer
          // that was right all along.
          hint={
            report.cancelledExcluded.count > 0
              ? `Excludes ${peso.format(report.cancelledExcluded.amount)} refunded on ` +
                `${report.cancelledExcluded.count} cancelled booking${
                  report.cancelledExcluded.count === 1 ? "" : "s"
                }`
              : singleDay
                ? "For this day"
                : "For this range"
          }
        />
        <StatCard
          label="Transactions"
          value={report.count}
          icon={Receipt}
          hint={`Average ${peso.format(report.count ? report.total / report.count : 0)}`}
        />
      </div>

      {/* Screen only, same reason: breakdowns are for reading at the desk, and
          every one of them is derivable from the transaction list below it. */}
      <div className="grid gap-4 lg:grid-cols-2 print:hidden">
        <SectionCard title="By payment mode">
          <BreakdownTable
            buckets={report.byMethod}
            countLabel="Payments"
            labelOf={(bucket) => METHOD_LABEL(bucket.key)}
            emptyText="No collections in this range."
          />
        </SectionCard>
        {allStaff ? (
          <SectionCard title="By receptionist">
            <BreakdownTable
              buckets={report.byStaff}
              countLabel="Payments"
              emptyText="No collections in this range."
            />
          </SectionCard>
        ) : null}
        {!singleDay ? (
          <SectionCard
            title="By day"
            aside="Cash / total"
            className={allStaff ? "lg:col-span-2" : undefined}
          >
            <DailyTable days={report.daily} />
          </SectionCard>
        ) : null}
      </div>

      {/* On paper the card chrome and its title both go: PrintHeader has
          already named the document, and a ruled box around a ruled table is
          two frames for one thing. */}
      <SectionCard
        title="Transactions"
        aside={`${report.count} payment${report.count === 1 ? "" : "s"}`}
        className="print:rounded-none print:py-0 print:shadow-none print:ring-0"
        headerClassName="print:hidden"
        contentClassName="px-0 pt-0"
      >
        <CollectionsLedger payments={report.payments} showStaff={allStaff} singleDay={singleDay} />
      </SectionCard>

      <SignatureBlock
        cash={report.cash}
        total={report.total}
        cancelledExcluded={report.cancelledExcluded}
      />
    </div>
  );
}

// Days with nothing collected are kept rather than dropped: on a remittance
// sheet "no money came in on the 4th" is a fact worth showing, not a gap.
function DailyTable({
  days,
}: {
  days: { date: string; label: string; count: number; cash: number; total: number }[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-xs">
          <th className="pb-1 text-left font-normal">Day</th>
          <th className="pb-1 text-right font-normal">Payments</th>
          <th className="pb-1 text-right font-normal">Cash</th>
          <th className="pb-1 text-right font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.date} className="border-border/60 border-t">
            <td className="py-1.5">{d.label}</td>
            <td className="text-muted-foreground py-1.5 text-right tabular-nums">{d.count}</td>
            <td className="py-1.5 text-right tabular-nums">{peso.format(d.cash)}</td>
            <td className="py-1.5 text-right font-medium tabular-nums">{peso.format(d.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
