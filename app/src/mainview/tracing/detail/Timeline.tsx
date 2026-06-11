import { cn } from "~/lib/ui";
import { formatDuration } from "~/lib/format";
import type { Span } from "../../../server/telemetry/types";
import { isSyntheticSpan } from "../spanTree";
import { spanKey } from "./spanUtils";

export function Timeline({
  recentSpanIds,
  spans,
}: {
  recentSpanIds: Set<string>;
  spans: Span[];
}) {
  if (spans.length === 0) {
    return <p className="text-sm text-muted-foreground">No spans to render.</p>;
  }
  const minStart = Math.min(...spans.map((span) => span.startTimeMs));
  const maxEnd = Math.max(...spans.map((span) => span.endTimeMs));
  const total = Math.max(1, maxEnd - minStart);

  return (
    <div className="space-y-3">
      {spans.map((span) => {
        const key = spanKey(span);
        const left = ((span.startTimeMs - minStart) / total) * 100;
        const width = Math.max(1, (span.durationMs / total) * 100);
        const recent = recentSpanIds.has(key);
        const synthetic = isSyntheticSpan(span);
        return (
          <div
            className={cn(
              "grid grid-cols-[240px_minmax(0,1fr)_90px] items-center gap-3 rounded-md px-2 py-1 transition",
              synthetic && "border border-dashed border-detail-brand/25 bg-detail-brand/5",
              recent && "live-span-flash",
            )}
            key={key}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{span.spanName}</p>
              <p className="text-xs text-muted-foreground">{span.observationKind}</p>
            </div>
            <div className="relative h-8 rounded-md border border-subtle bg-background-muted">
              <div
                className={cn(
                  "absolute top-1/2 h-3 -translate-y-1/2 rounded-full transition-[left,width]",
                  span.statusCode.includes("ERROR")
                    ? "bg-detail-failure"
                    : synthetic
                      ? "bg-detail-brand/40"
                      : "bg-detail-brand",
                  recent && "live-timeline-pulse",
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {formatDuration(span.durationMs)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
