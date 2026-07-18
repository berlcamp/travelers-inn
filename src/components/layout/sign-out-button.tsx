"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

// scope "local" so other apps sharing this Supabase project keep their sessions.
export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenuItem onClick={handleSignOut}>
      <LogOut className="size-4" />
      Sign out
    </DropdownMenuItem>
  );
}
