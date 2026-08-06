import { ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "@/components/layout/sign-out-button";

type HeaderUser = {
  fullName: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
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

export function AppHeader({ user }: { user: HeaderUser }) {
  const shortName = user.fullName.length > 22 ? `${user.fullName.slice(0, 20)}…` : user.fullName;

  return (
    <header className="border-border/60 bg-background/95 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b px-4 backdrop-blur-sm">
      <SidebarTrigger />

      <div className="bg-border h-5 w-px" />

      <div className="flex-1">
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-0.5">
        <span className="bg-muted text-muted-foreground mr-2 hidden rounded-full px-2.5 py-1 text-xs font-medium lg:inline">
          {user.roleLabel}
        </span>

        <ThemeToggle />

        <div className="bg-border mx-1 h-5 w-px" />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors outline-none">
                <Avatar className="size-7">
                  {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.fullName} /> : null}
                  <AvatarFallback className="bg-primary text-primary-foreground text-[10px] font-semibold">
                    {initials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-foreground hidden text-sm font-medium md:block">
                  {shortName}
                </span>
                <ChevronDown className="text-muted-foreground hidden size-3.5 md:block" />
              </button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-[230px]">
            <DropdownMenuLabel>
              <div className="flex items-center gap-3 py-1">
                <Avatar className="size-9 shrink-0">
                  {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt={user.fullName} /> : null}
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                    {initials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground truncate text-sm leading-none font-semibold">
                    {user.fullName}
                  </p>
                  <p className="text-muted-foreground truncate text-xs leading-none font-normal">
                    {user.email}
                  </p>
                  <p className="text-muted-foreground truncate pt-0.5 text-xs leading-none font-normal">
                    {user.roleLabel}
                  </p>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <SignOutButton />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
