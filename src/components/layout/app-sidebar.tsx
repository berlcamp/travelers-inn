"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
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
import { roleMatches, type UserRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  href: string;
  icon: React.ElementType;
  /**
   * The roles whose holders may open this page — the SAME list the page passes
   * to `pageRole`. Omitted means any signed-in staff member, matching a page
   * guarded by `requireUser` alone. Keep the two in step: an item drawn for
   * someone the page will refuse is the bug this field exists to prevent.
   */
  requires?: UserRole[];
};

// The front desk's day, in the order it happens: check what's free, see the
// week, work the reservations, then the rooms themselves and what guests said.
const FRONT_DESK: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    title: "Availability",
    href: "/availability",
    icon: Search,
    requires: ["admin", "front_desk"],
  },
  { title: "Calendar", href: "/calendar", icon: CalendarDays, requires: ["admin", "front_desk"] },
  { title: "Bookings", href: "/bookings", icon: ClipboardList, requires: ["admin", "front_desk"] },
  { title: "Rooms", href: "/rooms", icon: DoorOpen },
  { title: "Feedback", href: "/feedbacks", icon: MessageSquareHeart },
  // Front desk's own remittance sheet; admins see everyone's from the same
  // page. It sits with the daily work rather than under Reports because it's
  // something a receptionist prints at the end of a shift, not analysis.
  {
    title: "Collections",
    href: "/collections",
    icon: Banknote,
    requires: ["admin", "front_desk"],
  },
];

// Admin-only: what the inn *is* and who runs it, rather than what it's doing
// today. Filtered out entirely for front desk — a link that refuses to open
// reads as a fault rather than as a boundary.
const ADMIN: NavItem[] = [
  { title: "Reports", href: "/reports", icon: ChartColumn, requires: ["admin"] },
  { title: "Room Types", href: "/room-types", icon: Tags, requires: ["admin"] },
  { title: "Staff", href: "/users", icon: Users, requires: ["admin"] },
  { title: "Settings", href: "/settings", icon: Settings, requires: ["admin"] },
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

export function AppSidebar({ roles }: { roles: UserRole[] }) {
  // One predicate for the whole menu, shared with the page guards. A staff
  // member with no role yet (invited, or mid-change) simply gets the shorter
  // menu rather than a row of links that refuse to open.
  const visible = (items: NavItem[]) =>
    items.filter((item) => !item.requires || roleMatches(roles, item.requires));

  const frontDesk = visible(FRONT_DESK);
  const admin = visible(ADMIN);

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="border-sidebar-border flex h-14 items-center gap-3 border-b px-4">
          {/* The mark is dark teal, so it needs a light ground to read against
              the sidebar — which is dark in BOTH themes. */}
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white">
            <Image src="/logo-mark.png" alt="" width={64} height={64} className="size-6" priority />
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
            {frontDesk.map((item) => (
              <NavLink key={item.href} item={item} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {admin.length > 0 ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarMenu>
                {admin.map((item) => (
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
