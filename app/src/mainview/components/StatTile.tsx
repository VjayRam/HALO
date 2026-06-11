import type { ReactNode } from "react";

import { Card, Skeleton, cn } from "~/lib/ui";

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
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 border-b border-subtle px-6 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
