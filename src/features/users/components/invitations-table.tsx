"use client";

import { useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { revokeInvitation } from "@/features/users/actions";
import { ROLE_LABELS } from "@/features/users/schemas";
import type { InvitationRow } from "@/features/users/repository";
import { innFormatter } from "@/lib/inn-time";

const dt = innFormatter({ month: "short", day: "numeric", year: "numeric" });

function StatusBadge({ invitation }: { invitation: InvitationRow }) {
  if (invitation.status === "accepted") return <Badge>Accepted</Badge>;
  if (invitation.status === "revoked") return <Badge variant="secondary">Revoked</Badge>;
  if (invitation.isExpired || invitation.status === "expired")
    return <Badge variant="destructive">Expired</Badge>;
  return <Badge variant="outline">Pending</Badge>;
}

function RevokeButton({ invitation }: { invitation: InvitationRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function revoke() {
    startTransition(async () => {
      const result = await revokeInvitation(invitation.id);
      if (result.ok) {
        toast.success("Invitation revoked.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm" disabled={pending}>
          <Ban className="size-4" /> Revoke
        </Button>
      }
      title="Revoke this invitation?"
      description={`${invitation.email} will no longer be able to claim staff access. You can invite them again later.`}
      confirmLabel="Revoke"
      onConfirm={revoke}
    />
  );
}

const columns: ColumnDef<InvitationRow>[] = [
  { accessorKey: "email", header: "Email" },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) => <span className="text-sm">{ROLE_LABELS[row.original.role]}</span>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge invitation={row.original} />,
  },
  {
    id: "invited_by",
    header: "Invited by",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">{row.original.invitedByName ?? "—"}</span>
    ),
  },
  {
    id: "expires_at",
    header: "Expires",
    cell: ({ row }) => {
      const inv = row.original;
      if (inv.status === "accepted") {
        return (
          <span className="text-muted-foreground text-sm">
            Claimed {inv.accepted_at ? dt.format(new Date(inv.accepted_at)) : "—"}
          </span>
        );
      }
      return (
        <span className="text-muted-foreground text-sm">{dt.format(new Date(inv.expires_at))}</span>
      );
    },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    // Revoking only means anything while the row is still pending — accepted
    // and revoked rows are terminal.
    cell: ({ row }) => (
      <div className="flex justify-end">
        {row.original.status === "pending" ? <RevokeButton invitation={row.original} /> : null}
      </div>
    ),
  },
];

export function InvitationsTable({ invitations }: { invitations: InvitationRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={invitations}
      searchPlaceholder="Search invitations…"
      emptyMessage="No invitations yet."
    />
  );
}
