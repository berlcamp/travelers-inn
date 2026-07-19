import type { Metadata } from "next";
import { BedDouble } from "lucide-react";
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
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.auth) : null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <div className="bg-primary text-primary-foreground mb-2 flex size-12 items-center justify-center rounded-lg">
          <BedDouble className="size-6" />
        </div>
        <CardTitle className="text-xl">Bañares Traveler&apos;s Inn</CardTitle>
        <CardDescription>Booking &amp; Reservation Management</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {errorMessage ? (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-2 text-center text-xs"
          >
            {errorMessage}
          </p>
        ) : null}
        <GoogleSignInButton />
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-muted-foreground text-center text-xs">
          Staff access is by invitation only.
        </p>
      </CardFooter>
    </Card>
  );
}
