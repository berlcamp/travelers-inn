import type { Metadata } from "next";
import {
  BedDouble,
  CalendarArrowDown,
  CalendarArrowUp,
  Percent,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { getDashboardData } from "@/features/reports/repository";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { TrendBars } from "@/features/reports/components/trend-bars";
import { ArrivalsList } from "@/features/reports/components/arrivals-list";
import { peso } from "@/features/bookings/pricing";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];
  const d = await getDashboardData();

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-foreground text-xl leading-tight font-bold tracking-tight">
          Welcome back, {firstName}
        </h1>
        <p className="text-muted-foreground text-sm">Here&apos;s the front desk at a glance.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Arrivals today"
          value={d.arrivalsToday.length}
          icon={CalendarArrowDown}
          hint="Expected check-ins"
        />
        <StatCard
          label="Departures today"
          value={d.departuresToday.length}
          icon={CalendarArrowUp}
          hint="Expected check-outs"
        />
        <StatCard
          label="In-house"
          value={d.inHouse}
          icon={BedDouble}
          hint="Guests currently staying"
        />
        <StatCard
          label="Occupancy tonight"
          value={`${d.occupancyPct}%`}
          icon={Percent}
          hint={`${d.roomsOccupiedTonight} of ${d.roomsTotal} rooms`}
        />
        <StatCard
          label="Revenue today"
          value={peso.format(d.revenueToday)}
          icon={TrendingUp}
          hint="Payments recorded"
        />
        <StatCard
          label="Outstanding"
          value={peso.format(d.outstanding)}
          icon={Wallet}
          hint="Unpaid balance, active stays"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Today's arrivals"
          icon={CalendarArrowDown}
          aside={`${d.arrivalsToday.length} expected`}
        >
          <ArrivalsList
            bookings={d.arrivalsToday}
            timeField="checkIn"
            emptyText="No arrivals scheduled today."
          />
        </SectionCard>
        <SectionCard
          title="Today's departures"
          icon={CalendarArrowUp}
          aside={`${d.departuresToday.length} expected`}
        >
          <ArrivalsList
            bookings={d.departuresToday}
            timeField="checkOut"
            emptyText="No departures scheduled today."
          />
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Revenue" icon={TrendingUp} aside="last 7 days">
          <TrendBars points={d.revenue7d} format="peso" />
        </SectionCard>
        <SectionCard title="Occupancy" icon={Percent} aside="last 7 days">
          <TrendBars points={d.occupancy7d} format="count" />
        </SectionCard>
      </div>
    </div>
  );
}
