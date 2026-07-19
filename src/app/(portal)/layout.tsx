import Link from "next/link";
import { Fraunces } from "next/font/google";
import { BedDouble } from "lucide-react";

// A characterful soft-serif for the portal's display type — gives the public
// site its own editorial, hospitality voice, distinct from the staff tools.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} bg-background text-foreground flex min-h-svh flex-col`}
    >
      <header className="border-border/60 sticky top-0 z-20 border-b backdrop-blur-md">
        <div className="bg-background/70 absolute inset-0 -z-10" />
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl">
              <BedDouble className="size-5" />
            </span>
            <span className="font-[family-name:var(--font-fraunces)] text-xl font-semibold tracking-tight">
              Bañares Traveler&apos;s Inn
            </span>
          </Link>
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            Staff sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-2 px-5 py-8 text-sm sm:flex-row sm:items-center">
          <span className="font-[family-name:var(--font-fraunces)] text-foreground text-base">
            Bañares Traveler&apos;s Inn
          </span>
          <span>A warm welcome, any hour of the day.</span>
        </div>
      </footer>
    </div>
  );
}
