import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { requireRole } from "@/lib/auth/guards";
import { listStaff, listInvitations } from "@/features/users/repository";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StaffTable } from "@/features/users/components/staff-table";
import { InvitationsTable } from "@/features/users/components/invitations-table";
import { InviteDialog } from "@/features/users/components/invite-dialog";

export const metadata: Metadata = { title: "Staff" };

export default async function UsersPage() {
  const user = await requireRole(["admin"]);
  const [staff, invitations] = await Promise.all([listStaff(), listInvitations()]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        title="Staff"
        description="Who can sign in to the inn's tools, and who's been invited."
        actions={
          <InviteDialog
            trigger={
              <Button>
                <UserPlus className="size-4" /> Invite staff
              </Button>
            }
          />
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Members</h2>
        <StaffTable staff={staff} currentUserId={user.id} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Invitations</h2>
          <p className="text-muted-foreground text-xs">
            An invitation is claimed the first time its Google account signs in — nothing is emailed
            from here.
          </p>
        </div>
        <InvitationsTable invitations={invitations} />
      </section>
    </div>
  );
}
