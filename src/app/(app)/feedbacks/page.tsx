import type { Metadata } from "next";
import { CalendarDays, MessageSquareHeart, Star } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { listFeedback, computeFeedbackStats } from "@/features/feedback/repository";
import { FeedbacksTable } from "@/features/feedback/components/feedbacks-table";

export const metadata: Metadata = { title: "Feedback" };

export default async function FeedbacksPage() {
  await requireUser();
  const feedback = await listFeedback();
  const stats = computeFeedbackStats(feedback);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Guest feedback"
        description="Submitted by guests scanning the QR code in their room."
      />

      {feedback.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title="No feedback yet"
          description="Print the room QR codes and place one in each room — responses will appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Average rating" value={`${stats.average} / 5`} icon={Star} />
            <StatCard label="Total responses" value={stats.count} icon={MessageSquareHeart} />
            <StatCard label="Last 30 days" value={stats.last30} icon={CalendarDays} />
          </div>
          <FeedbacksTable feedback={feedback} />
        </>
      )}
    </div>
  );
}
