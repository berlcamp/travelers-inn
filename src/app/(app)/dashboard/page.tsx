import type { Metadata } from "next";
import { CalendarCheck, DoorOpen, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

const STATS = [
  { label: "Arrivals today", value: "—", icon: CalendarCheck, hint: "Check-ins expected" },
  { label: "Occupancy", value: "—", icon: DoorOpen, hint: "Rooms occupied" },
  { label: "Revenue today", value: "—", icon: TrendingUp, hint: "Payments recorded" },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(" ")[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground text-sm">
          Here&apos;s the front desk at a glance. Live figures arrive with the bookings module.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STATS.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </CardTitle>
              <stat.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{stat.value}</div>
              <p className="text-muted-foreground text-xs">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
