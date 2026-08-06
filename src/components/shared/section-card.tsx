import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The panel every figure, chart and mini-list on the dashboard and reports
 * sits in: a ruled header carrying a small uppercase label, and the content
 * below it. Titles are set as labels rather than headings because the number
 * inside is what the eye should land on first.
 */
export function SectionCard({
  title,
  icon: Icon,
  aside,
  className,
  contentClassName,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  /** Right-hand note in the header row — a count, a unit, a caveat. */
  aside?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("border-border/60 gap-0 border shadow-sm ring-0", className)}>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 border-b pb-4">
        <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-semibold tracking-widest uppercase">
          {Icon ? <Icon className="size-4" /> : null}
          {title}
        </CardTitle>
        {aside ? <p className="text-muted-foreground text-xs">{aside}</p> : null}
      </CardHeader>
      <CardContent className={cn("pt-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
