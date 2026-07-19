import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, ArrowLeft, ShieldCheck } from "lucide-react";
import { GoogleSignInButton } from "@/features/auth/components/google-sign-in-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  uninvited: "This Google account has not been invited. Contact the inn administrator.",
  deactivated: "Your account has been deactivated. Contact the inn administrator.",
  auth: "Sign-in failed. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { error, detail } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth) : null;

  return (
    <div className="flex flex-col gap-5">
      <Card className="w-full overflow-hidden rounded-2xl border-border/80 shadow-xl shadow-primary/5">
        <CardHeader className="items-center gap-3 pt-8 text-center">
          <div className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl shadow-md ring-1 ring-black/5">
            <BedDouble className="size-7" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold tracking-tight">
              Bañares Traveler&apos;s Inn
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Staff &amp; front-desk sign in
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-2">
          {errorMessage ? (
            <div
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive space-y-1 rounded-lg border p-2.5 text-center text-xs"
            >
              <p>{errorMessage}</p>
              {detail ? (
                <p className="text-destructive/80 break-words font-mono text-[0.7rem] leading-snug">
                  {detail}
                </p>
              ) : null}
            </div>
          ) : null}
          <GoogleSignInButton />
          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground text-[0.7rem] font-medium uppercase tracking-[0.15em]">
              Booking &amp; Reservations
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </CardContent>
        <CardFooter className="justify-center pb-7">
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-center text-xs">
            <ShieldCheck className="size-3.5" />
            Staff access is by invitation only.
          </p>
        </CardFooter>
      </Card>

      <Link
        href="/"
        className="text-muted-foreground hover:text-foreground group mx-auto inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5" />
        Back to booking
      </Link>
    </div>
  );
}
