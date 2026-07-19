import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// The variable names are load-bearing: globals.css maps --font-sans/--font-mono
// straight through, so the family only exists if next/font defines that exact
// name here.
const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Bañares Traveler's Inn",
    template: "%s · Bañares Traveler's Inn",
  },
  description: "Booking & Reservation Management System for Bañares Traveler's Inn",
  // Social share card (Facebook / Open Graph). Uses the public, guest-facing
  // copy rather than the internal system description.
  openGraph: {
    type: "website",
    siteName: "Bañares Traveler's Inn",
    title: "Bañares Traveler's Inn",
    description:
      "Nightly stays and short day-use rooms in the heart of town. Check availability, book in seconds",
    images: [
      {
        url: "/og-couple.jpg",
        width: 2048,
        height: 1536,
        alt: "Bañares Traveler's Inn",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Bañares Traveler's Inn",
    description:
      "Nightly stays and short day-use rooms in the heart of town. Check availability, book in seconds",
    images: ["/og-couple.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
