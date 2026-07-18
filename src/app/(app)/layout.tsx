import { requireUser, hasRole } from "@/lib/auth/guards";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  front_desk: "Front Desk",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = hasRole(user, "admin");
  const roleLabel =
    user.roles.length > 0
      ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")
      : "No role assigned";

  return (
    <SidebarProvider>
      <AppSidebar isAdmin={isAdmin} />
      <SidebarInset>
        <AppHeader
          user={{
            fullName: user.fullName,
            email: user.email,
            avatarUrl: user.avatarUrl,
            roleLabel,
          }}
        />
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
