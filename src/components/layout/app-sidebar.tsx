"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BedDouble,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  DoorOpen,
  LayoutDashboard,
  MessageSquareHeart,
  Search,
  Settings,
  Tags,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: React.ElementType;
};

// The front desk's day, in the order it happens: check what's free, see the
// week, work the reservations, then the rooms themselves and what guests said.
const FRONT_DESK: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Availability", href: "/availability", icon: Search },
  { title: "Calendar", href: "/calendar", icon: CalendarDays },
  { title: "Bookings", href: "/bookings", icon: ClipboardList },
  { title: "Rooms", href: "/rooms", icon: DoorOpen },
  { title: "Feedback", href: "/feedbacks", icon: MessageSquareHeart },
];

// Admin-only: what the inn *is* and who runs it, rather than what it's doing
// today. Filtered out entirely for front desk — a link that 403s reads as a
// fault rather than as a boundary.
const ADMIN: NavItem[] = [
  { title: "Reports", href: "/reports", icon: ChartColumn },
  { title: "Room Types", href: "/room-types", icon: Tags },
  { title: "Staff", href: "/users", icon: Users },
  { title: "Settings", href: "/settings", icon: Settings },
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <SidebarMenuItem>
      <Link
        href={item.href}
        className={cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
            : "text-sidebar-foreground hover:bg-sidebar-hover"
        )}
      >
        {/* Blue active indicator */}
        <span
          className={cn(
            "bg-sidebar-primary absolute inset-y-1.5 left-0 w-0.5 rounded-r-full transition-all",
            isActive ? "opacity-100" : "opacity-0"
          )}
        />
        <item.icon
          className={cn(
            "size-4 shrink-0 transition-colors",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-sidebar-muted-foreground group-hover:text-sidebar-foreground"
          )}
        />
        <span>{item.title}</span>
      </Link>
    </SidebarMenuItem>
  );
}

export function AppSidebar({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="border-sidebar-border flex h-14 items-center gap-3 border-b px-4">
          <div className="bg-sidebar-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
            <BedDouble className="text-sidebar-primary-foreground size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sidebar-foreground truncate text-sm leading-tight font-bold tracking-wide">
              BAÑARES INN
            </p>
            <p className="text-sidebar-muted-foreground truncate text-[10px] leading-tight tracking-wide">
              Reservations
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {FRONT_DESK.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {isAdmin ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarMenu>
                {ADMIN.map((item) => (
                  <NavLink key={item.href} item={item} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
