import { Fraunces } from "next/font/google";

// Match the portal's editorial display face on the staff sign-in screen.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      className={`${fraunces.variable} force-light relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-white p-4`}
    >
      {/* Slim brass rule + soft brand glows on a clean white canvas. */}
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[oklch(0.72_0.13_65)] via-[oklch(0.62_0.13_55)] to-[oklch(0.42_0.07_185)]" />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.5] [background-image:radial-gradient(circle_at_1px_1px,oklch(0.5_0.03_185)_1px,transparent_0)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <div
        aria-hidden
        className="absolute -top-24 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-[oklch(0.42_0.07_185)]/6 blur-3xl"
      />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </main>
  );
}
