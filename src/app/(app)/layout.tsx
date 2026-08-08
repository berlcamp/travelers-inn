import { requireUser } from "@/lib/auth/guards";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const roleLabel =
    user.roles.length > 0
      ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(" · ")
      : "No role assigned";

  return (
    <SidebarProvider>
      <AppSidebar roles={user.roles} />
      <SidebarInset>
        <AppHeader
          user={{
            fullName: user.fullName,
            email: user.email,
            avatarUrl: user.avatarUrl,
            roleLabel,
          }}
        />
        {/* No padding on paper: the @page margin already provides the real
            one, and doubling it costs rows on a sheet meant to hold a whole
            shift. */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 print:p-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
