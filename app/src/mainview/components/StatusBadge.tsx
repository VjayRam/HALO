import { AlertCircle, CheckCircle2, Clock3 } from "lucide-react";

import { Badge } from "~/lib/ui";

/** Semantic badge for run/engine/provider lifecycle states. */
export function StatusBadge({
  size,
  status,
}: {
  size?: "default" | "sm";
  status: string;
}) {
  const active = ["queued", "exporting", "running", "installing"].includes(status);
  const ok = ["completed", "installed", "connected"].includes(status);
  const bad = ["failed", "error", "cancelled", "interrupted"].includes(status);
  return (
    <Badge
      className="gap-1.5"
      size={size}
      variant={
        bad
          ? "status-failure"
          : ok
            ? "status-success"
            : active
              ? "status-running"
              : "outline"
      }
    >
      {active ? (
        <Clock3 className="h-3 w-3" />
      ) : ok ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : bad ? (
        <AlertCircle className="h-3 w-3" />
      ) : null}
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-detail-brand transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
