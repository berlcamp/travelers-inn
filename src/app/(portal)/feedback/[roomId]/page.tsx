import type { Metadata } from "next";
import { getRoomPublic } from "@/features/feedback/repository";
import { FeedbackForm } from "@/features/feedback/components/feedback-form";

export const metadata: Metadata = { title: "Share your feedback" };

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const room = await getRoomPublic(roomId);

  // A neutral message either way — never reveal whether an id exists.
  if (!room) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-5 py-24 text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
          We couldn&apos;t find that room
        </h1>
        <p className="text-muted-foreground">
          Please check the code on your room tag, or ask our front desk for help.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-5 py-12">
      <div className="mb-8 text-center">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">
          Room {room.label}
          {room.typeName ? ` · ${room.typeName}` : ""}
        </p>
        <h1 className="font-[family-name:var(--font-fraunces)] mt-2 text-3xl font-semibold tracking-tight">
          How did we do?
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          It takes fifteen seconds and helps us look after the next guest.
        </p>
      </div>
      <FeedbackForm roomId={room.id} />
    </div>
  );
}
