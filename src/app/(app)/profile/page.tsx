import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileForm } from "@/features/profile/components/profile-form";

export const metadata: Metadata = { title: "Profile" };

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  front_desk: "Front Desk",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ProfilePage() {
  // Every signed-in staff member has a profile — no role gate.
  const user = await requireUser();
  const roleLabel =
    user.roles.length > 0
      ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")
      : "No role assigned";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Your profile" description="How you appear across the inn's tools." />

      <SectionCard title="Account" contentClassName="pt-4">
        <div className="flex items-center gap-4">
          <Avatar className="size-14 shrink-0">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
              {initials(user.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-semibold">{user.fullName}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            <p className="text-muted-foreground truncate text-xs">{roleLabel}</p>
          </div>
        </div>
        {/* Said once, here, rather than as three disabled inputs below: the
            email is the Google account that was invited, the role is an
            administrator's decision, and the photo is whatever Google holds.
            None of the three is editable from this app, so none of them is
            drawn as a field. */}
        <p className="text-muted-foreground mt-4 text-xs">
          Your email address and photo come from the Google account you sign in with, and your role
          is set by an administrator — none of them can be changed here.
        </p>
      </SectionCard>

      <ProfileForm fullName={user.fullName} />
    </div>
  );
}
