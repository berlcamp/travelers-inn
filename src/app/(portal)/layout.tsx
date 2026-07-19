import Link from "next/link";
import { Fraunces } from "next/font/google";
import { BedDouble, ArrowUpRight } from "lucide-react";

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
      className={`${fraunces.variable} force-light bg-background text-foreground flex min-h-svh flex-col`}
    >
      {/* Slim brass rule — a small boutique-hotel signature across the top. */}
      <div className="h-1 w-full bg-gradient-to-r from-[oklch(0.72_0.13_65)] via-[oklch(0.62_0.13_55)] to-[oklch(0.42_0.07_185)]" />

      <header className="border-border sticky top-0 z-20 border-b bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="group flex items-center gap-3">
            <span className="bg-primary text-primary-foreground flex size-10 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5">
              <BedDouble className="size-5" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="font-[family-name:var(--font-fraunces)] text-lg font-semibold tracking-tight">
                Bañares Traveler&apos;s Inn
              </span>
              <span className="text-muted-foreground mt-1 text-[0.7rem] font-medium uppercase tracking-[0.18em]">
                Rooms &amp; Reservations
              </span>
            </span>
          </Link>
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground group inline-flex items-center gap-1.5 rounded-full border border-transparent px-3.5 py-2 text-sm font-medium transition-colors hover:border-border"
          >
            Staff sign in
            <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-border mt-8 border-t bg-[oklch(0.99_0.006_85)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
              <BedDouble className="size-4.5" />
            </span>
            <div>
              <p className="font-[family-name:var(--font-fraunces)] text-foreground text-base font-semibold">
                Bañares Traveler&apos;s Inn
              </p>
              <p className="text-muted-foreground text-sm">A warm welcome, any hour of the day.</p>
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {`© ${new Date().getFullYear()} Bañares Traveler's Inn. All rights reserved.`}
          </p>
        </div>
      </footer>
    </div>
  );
}
