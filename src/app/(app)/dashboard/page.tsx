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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendBars } from "@/features/reports/components/trend-bars";
import { ArrivalsList } from "@/features/reports/components/arrivals-list";
import { peso } from "@/features/bookings/pricing";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];
  const d = await getDashboardData();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground text-sm">Here&apos;s the front desk at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <StatCard label="In-house" value={d.inHouse} icon={BedDouble} hint="Guests currently staying" />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today&apos;s arrivals</CardTitle>
          </CardHeader>
          <CardContent>
            <ArrivalsList
              bookings={d.arrivalsToday}
              timeField="checkIn"
              emptyText="No arrivals scheduled today."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Today&apos;s departures</CardTitle>
          </CardHeader>
          <CardContent>
            <ArrivalsList
              bookings={d.departuresToday}
              timeField="checkOut"
              emptyText="No departures scheduled today."
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Revenue · last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBars points={d.revenue7d} format="peso" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Occupancy · last 7 days</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBars points={d.occupancy7d} format="count" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
