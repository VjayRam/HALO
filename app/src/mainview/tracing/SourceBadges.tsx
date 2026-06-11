import { DownloadCloud } from "lucide-react";

import { Badge } from "~/lib/ui";
import { formatTimestamp, sourceLabel } from "~/lib/format";
import type { SessionSummary, Trace } from "../../server/telemetry/types";

export function TraceSourceBadge({ trace }: { trace: Trace }) {
  if (trace.source === "local") return null;
  const label = sourceLabel(trace.source);
  const title = [
    trace.sourceConnectionName ? `Connection: ${trace.sourceConnectionName}` : null,
    trace.sourceImportedAt ? `Imported: ${formatTimestamp(trace.sourceImportedAt)}` : null,
    trace.sourceTraceId ? `${label} trace: ${trace.sourceTraceId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Badge className="gap-1" size="sm" title={title} variant="status-brand">
      <DownloadCloud className="h-3 w-3" />
      {label}
    </Badge>
  );
}

export function SessionSourceBadge({ session }: { session: SessionSummary }) {
  const imported = session.sources.filter((source) => source !== "local");
  if (imported.length === 0) return null;
  const mixed = session.sources.includes("local") || imported.length > 1;
  const label = sourceLabel(imported[0] ?? "");
  const title = [
    mixed ? "Includes traces from multiple sources" : `Imported from ${label}`,
    ...session.sourceConnectionNames.map((name) => `Connection: ${name}`),
  ].join("\n");
  return (
    <Badge className="gap-1" size="sm" title={title} variant="status-brand">
      <DownloadCloud className="h-3 w-3" />
      {mixed ? "Mixed" : label}
    </Badge>
  );
}
