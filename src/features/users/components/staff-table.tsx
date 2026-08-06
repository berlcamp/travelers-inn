"use client";

import { useMemo, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, includesValue } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { setStaffActive, setStaffRole } from "@/features/users/actions";
import { ROLE_LABELS, USER_ROLES, type UserRole } from "@/features/users/schemas";
import type { StaffMember } from "@/features/users/repository";

const dt = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function RoleSelect({ member, disabled }: { member: StaffMember; disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A member can technically hold several roles; admin outranks the rest, so
  // that's what the single-select shows. No role yet → nothing selected.
  const current = member.roles.includes("admin") ? "admin" : (member.roles[0] ?? null);
  const items = USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  function onChange(next: string | null) {
    if (!next || next === current) return;
    startTransition(async () => {
      const result = await setStaffRole(member.id, next as UserRole);
      if (result.ok) {
        toast.success(`Role set to ${ROLE_LABELS[next as UserRole]}.`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Select items={items} value={current} onValueChange={onChange} disabled={disabled || pending}>
      <SelectTrigger className="h-8 w-40" aria-label={`Role for ${member.full_name}`}>
        <SelectValue placeholder="No role" />
      </SelectTrigger>
      <SelectContent>
        {USER_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActiveToggle({ member }: { member: StaffMember }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle(active: boolean) {
    startTransition(async () => {
      const result = await setStaffActive(member.id, active);
      if (result.ok) {
        toast.success(active ? "Access restored." : "Access revoked.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (member.is_active) {
    return (
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" disabled={pending}>
            <PowerOff className="size-4" /> Deactivate
          </Button>
        }
        title={`Deactivate ${member.full_name}?`}
        description="They stay in the records but are signed out of the staff tools until reactivated."
        confirmLabel="Deactivate"
        onConfirm={() => toggle(false)}
      />
    );
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => toggle(true)}>
      <Power className="size-4" /> Activate
    </Button>
  );
}

function buildColumns(currentUserId: string): ColumnDef<StaffMember>[] {
  return [
    {
      id: "member",
      header: "Member",
      // Both name and email feed the accessor so the search box matches either.
      accessorFn: (row) => `${row.full_name} ${row.email}`,
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              {m.avatar_url ? <AvatarImage src={m.avatar_url} alt="" /> : null}
              <AvatarFallback>{initials(m.full_name)}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-medium">
                {m.full_name}
                {m.id === currentUserId ? (
                  <span className="text-muted-foreground font-normal"> · you</span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs">{m.email}</span>
            </div>
          </div>
        );
      },
    },
    {
      id: "role",
      header: "Role",
      // Admin outranks the rest, so that's what both the select and the filter
      // key on — a member with two roles is filed under the one that decides
      // what they can do.
      accessorFn: (row) => (row.roles.includes("admin") ? "admin" : (row.roles[0] ?? "none")),
      filterFn: includesValue,
      // Self is read-only: an admin who demotes themselves mid-session would
      // lose this page (and, if they're the only admin, the inn would too).
      cell: ({ row }) => (
        <RoleSelect member={row.original} disabled={row.original.id === currentUserId} />
      ),
    },
    {
      accessorKey: "is_active",
      header: "Status",
      filterFn: includesValue,
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge>Active</Badge>
        ) : (
          <Badge variant="secondary">Deactivated</Badge>
        ),
    },
    {
      accessorKey: "created_at",
      header: "Joined",
      cell: ({ row }) => (
        <span className="text-muted-foreground text-sm">
          {dt.format(new Date(row.original.created_at))}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end">
          {row.original.id === currentUserId ? null : <ActiveToggle member={row.original} />}
        </div>
      ),
    },
  ];
}

export function StaffTable({
  staff,
  currentUserId,
}: {
  staff: StaffMember[];
  currentUserId: string;
}) {
  const columns = useMemo(() => buildColumns(currentUserId), [currentUserId]);

  return (
    <DataTable
      columns={columns}
      data={staff}
      searchPlaceholder="Search staff…"
      filterableColumns={[
        {
          id: "role",
          title: "Role",
          options: [
            ...USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            { value: "none", label: "No role" },
          ],
        },
        {
          id: "is_active",
          title: "Status",
          options: [
            { value: "true", label: "Active" },
            { value: "false", label: "Deactivated" },
          ],
        },
      ]}
      emptyMessage="No staff yet."
    />
  );
}
