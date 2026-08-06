import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="space-y-1">
        <h1 className="text-foreground text-xl leading-tight font-bold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A titled block within a page. Matches the card chrome the tables use, so a
 * form section and a list section sit on the same surface.
 */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-2", className)}>
      <div className="space-y-0.5">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-widest uppercase">
          {title}
        </h2>
        {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
