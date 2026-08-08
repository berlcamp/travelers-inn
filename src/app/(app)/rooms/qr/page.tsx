import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { listRoomsWithType } from "@/features/rooms/repository";
import { feedbackUrlFor } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { QrPrintButton } from "@/features/rooms/components/qr-print-button";

export const metadata: Metadata = { title: "Room QR codes" };

export default async function RoomQrPage() {
  await requireUser();
  const rooms = await listRoomsWithType();

  // Rendered server-side as inline SVG: no external image service, so the
  // codes print identically offline and cost nothing per render.
  const cards = await Promise.all(
    rooms.map(async (room) => ({
      id: room.id,
      label: room.label,
      typeName: room.room_type?.name ?? null,
      svg: await QRCode.toString(feedbackUrlFor(room.id), {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
      }),
    }))
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4 print:hidden">
        <div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/rooms" />}
            className="text-muted-foreground -ml-2 mb-2"
          >
            <ArrowLeft className="size-4" /> Back to rooms
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Room QR codes</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Print, cut, and place one in each room. Guests scan it to leave feedback.
          </p>
        </div>
        <QrPrintButton />
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-12 text-center">
          No rooms yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-3 print:gap-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border border-neutral-300 bg-white p-4 text-center text-neutral-900"
            >
              <div className="text-lg font-semibold">Room {card.label}</div>
              {card.typeName ? (
                <div className="text-xs text-neutral-500">{card.typeName}</div>
              ) : null}
              {/* Safe: `svg` comes from the `qrcode` library encoding a URL we
                  built ourselves out of a room UUID — no user-controlled
                  content ever reaches this HTML. */}
              <div
                className="size-36 [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: card.svg }}
              />
              <div className="text-xs font-medium">Scan to share your feedback</div>
              <div className="flex items-center gap-1.5 text-[0.65rem] text-neutral-500">
                <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-4" />
                Bañares Traveler&apos;s Inn
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
