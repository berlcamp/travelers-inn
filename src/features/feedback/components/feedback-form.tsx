"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Heart, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/features/feedback/actions";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

export function FeedbackForm({ roomId }: { roomId: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [guestName, setGuestName] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) {
      toast.error("Please choose a rating first.");
      return;
    }
    startTransition(async () => {
      const result = await submitFeedback({
        room_id: roomId,
        rating,
        comment,
        guest_name: guestName,
      });
      if (result.ok) setDone(true);
      else toast.error(result.error);
    });
  }

  if (done) {
    return (
      <div className="border-border bg-card flex flex-col items-center gap-4 rounded-2xl border p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-600">
          <Heart className="size-7" />
        </div>
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl font-semibold">
          Thank you!
        </h2>
        <p className="text-muted-foreground text-sm">
          Your feedback goes straight to our team. We&apos;re glad you stayed with us.
        </p>
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col items-center gap-2">
        <legend className="sr-only">Rate your stay from 1 to 5 stars</legend>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(0)}
              aria-pressed={n === rating}
              aria-label={`${n} star${n === 1 ? "" : "s"}${RATING_WORDS[n] ? ` — ${RATING_WORDS[n]}` : ""}`}
              className="focus-visible:ring-ring rounded-md p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            >
              <Star
                className={`size-9 ${
                  n <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                }`}
              />
            </button>
          ))}
        </div>
        <span className="text-muted-foreground h-5 text-sm" aria-live="polite">
          {RATING_WORDS[shown] ?? ""}
        </span>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="comment" className="text-sm font-medium">
          How was your stay?
        </label>
        <Textarea
          id="comment"
          rows={4}
          maxLength={1000}
          placeholder="Anything you loved, or anything we could do better…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="guest_name" className="text-sm font-medium">
          Your name <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <Input
          id="guest_name"
          maxLength={120}
          placeholder="Leave blank to stay anonymous"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
        />
      </div>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send feedback"}
      </Button>
    </form>
  );
}
