import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";

/**
 * What a page renders instead of itself when `pageRole` says no. Rendered by
 * the page, so the URL, the sidebar and the header all stay put — the person
 * can see where they are and click somewhere else.
 *
 * It names the roles that would open the page. That is not a secret worth
 * keeping from a signed-in colleague, and without it the only next step is to
 * ask an administrator a question neither of them can answer.
 */
export function AccessDenied({ requires }: { requires: UserRole[] }) {
  const labels = requires.map((role) => ROLE_LABELS[role] ?? role);
  const list =
    labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : labels[0];
  // Built here rather than interpolated mid-JSX: the surrounding text wraps,
  // and JSX drops the whitespace around a newline — which silently produced
  // "Administratoraccounts".
  const opensFor = `It's open to ${list} accounts.`;

  return (
    <div className="border-border/60 bg-card mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border p-12 text-center shadow-sm">
      <div className="bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full">
        <Lock className="size-5" />
      </div>
      <p className="text-base font-semibold">This page isn&apos;t part of your access</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        {opensFor} Ask an administrator if you need it — nothing is broken, and you&apos;re still
        signed in.
      </p>
      <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
        Back to dashboard
      </Button>
    </div>
  );
}
