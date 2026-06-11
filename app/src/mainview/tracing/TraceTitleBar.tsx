import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Badge, cn } from "~/lib/ui";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

/** Live ingest/WS status pill shown in the traces page header. */
export function LiveStatusBadge({
  health,
  liveStatus,
  liveUrl,
}: {
  health: string;
  liveStatus: LiveStatus;
  liveUrl: string;
}) {
  const live = liveStatus === "live";
  const reconnecting = liveStatus === "reconnecting" || liveStatus === "connecting";
  const accepted = health === "accepted";
  const waiting = health === "waiting";
  const healthLabel = accepted
    ? "receiving telemetry"
    : waiting
      ? "waiting for telemetry"
      : health.replaceAll("_", " ");
  const liveLabel = live
    ? "live updates connected"
    : reconnecting
      ? "live updates connecting"
      : "live updates offline";
  const label = live
    ? accepted
      ? "Live ingest"
      : waiting
        ? "Live · waiting"
        : `Live · ${healthLabel}`
    : reconnecting
      ? "Connecting"
      : accepted
        ? "Ingest OK"
        : "Offline";
  const variant =
    live && accepted
      ? "status-success"
      : live || reconnecting
        ? "status-brand"
        : accepted
          ? "status-success"
          : "outline";
  return (
    <Badge
      className="gap-2"
      title={`Realtime: ${liveLabel}. Ingest: ${healthLabel}. Socket: ${liveUrl}`}
      variant={variant}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          live ? "bg-detail-brand" : "bg-muted-foreground",
          live && "animate-pulse",
        )}
      />
      {accepted ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : waiting ? (
        <AlertCircle className="h-3 w-3" />
      ) : null}
      {label}
    </Badge>
  );
}
