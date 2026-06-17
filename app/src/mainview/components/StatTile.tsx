import { Children, Fragment, type ReactNode } from "react";

import { Card, Skeleton, cn } from "~/lib/ui";

/**
 * Compact labeled stat cell for horizontal stat strips.
 */
export function StatCell({
  className,
  detail,
  icon,
  label,
  loading,
  value,
}: {
  className?: string;
  detail?: ReactNode;
  icon: ReactNode;
  label: string;
  loading?: boolean;
  value: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-[7rem] flex-1 flex-col gap-1.5 self-stretch px-4 py-3", className)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/75">
        <span className="text-muted-foreground/65 [&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="truncate text-sm font-medium text-foreground">
        {loading ? <Skeleton className="h-4 w-12 rounded-md" /> : value}
      </div>
      {detail ? (
        <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

/**
 * Compact labeled stat card matching the web app's LabeledStatTile style.
 */
export function StatTile({
  className,
  detail,
  icon,
  label,
  loading,
  value,
}: {
  className?: string;
  detail?: ReactNode;
  icon: ReactNode;
  label: string;
  loading?: boolean;
  value: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "min-w-28 flex-1 rounded-xl border-border/55 bg-background/45 px-3 py-2.5 shadow-none",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/75">
        <span className="text-muted-foreground/65 [&>svg]:h-3 [&>svg]:w-3">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-sm font-medium text-foreground">
        {loading ? <Skeleton className="h-4 w-12 rounded-md" /> : value}
      </div>
      {detail ? (
        <div className="mt-1 truncate text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </Card>
  );
}

export function StatStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const items = Children.toArray(children);

  return (
    <div
      className={cn(
        "flex flex-wrap items-stretch border-b border-subtle px-6",
        className,
      )}
    >
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <div aria-hidden className="w-px shrink-0 self-stretch bg-border/50" />
          ) : null}
          {child}
        </Fragment>
      ))}
    </div>
  );
}
