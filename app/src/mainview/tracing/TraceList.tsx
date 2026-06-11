import type { ReactNode } from "react";
import { Loader2, Search } from "lucide-react";

import { Badge, EmptyState, cn } from "~/lib/ui";
import {
  formatDuration,
  formatTimestamp,
  shortId,
  sourceLabel,
} from "~/lib/format";
import { showDesktopRowContextMenu } from "~/desktop/desktopBridge";
import type { Trace } from "../../server/telemetry/types";
import { TraceSourceBadge } from "./SourceBadges";

const GRID_COLS =
  "grid-cols-[minmax(240px,1.4fr)_minmax(110px,0.6fr)_100px_110px_90px_150px]";

export function TraceList({
  activeTraceId,
  isLoading,
  onSelectTrace,
  recentTraceIds,
  totalCount,
  traces,
}: {
  activeTraceId?: string;
  isLoading: boolean;
  onSelectTrace: (traceId: string) => void;
  recentTraceIds: Set<string>;
  totalCount: number;
  traces: Trace[];
}) {
  if (isLoading && traces.length === 0) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="flex flex-1 p-8">
        <EmptyState
          className="w-full self-center"
          description="Broaden the filters or wait for another local ingest batch."
          icon={Search}
          title="No matching traces"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-6 pb-6 pt-4">
        <div className="rounded-xl border border-border/55">
          <div
            className={cn(
              "grid rounded-t-xl border-b border-border/50 bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
              GRID_COLS,
            )}
          >
            <div>Trace</div>
            <div>Service</div>
            <div className="text-right">Duration</div>
            <div className="text-right">Spans</div>
            <div className="text-right">Tokens</div>
            <div className="pl-4">Started</div>
          </div>
          <div>
            {traces.map((trace) => (
              <button
                className={cn(
                  "grid w-full items-center border-b border-border/40 px-4 py-3 text-left transition last:border-b-0 last:rounded-b-xl hover:bg-muted/50",
                  GRID_COLS,
                  activeTraceId === trace.traceId && "bg-muted",
                  recentTraceIds.has(trace.traceId) && "live-trace-flash",
                )}
                key={trace.traceId}
                onClick={() => onSelectTrace(trace.traceId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void showDesktopRowContextMenu({
                    id: trace.traceId,
                    kind: "trace",
                    sourceName:
                      trace.source === "local" ? null : sourceLabel(trace.source),
                    sourceUrl: trace.sourceUrl,
                  });
                }}
                type="button"
              >
                <div className="min-w-0 pr-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        trace.hasError ? "bg-detail-failure" : "bg-detail-success",
                      )}
                      title={trace.hasError ? "error" : "ok"}
                    />
                    <span className="truncate text-sm font-medium">
                      {trace.rootSpanName || "unnamed trace"}
                    </span>
                    {recentTraceIds.has(trace.traceId) ? (
                      <Badge size="sm" variant="status-brand">
                        new
                      </Badge>
                    ) : null}
                    <TraceSourceBadge trace={trace} />
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                    <span className="font-mono" title={trace.traceId}>
                      {shortId(trace.traceId)}
                    </span>
                    {trace.agentName ? (
                      <span className="max-w-40 truncate" title={trace.agentName}>
                        {trace.agentName}
                      </span>
                    ) : null}
                    {trace.source !== "local" && trace.sourceTraceId ? (
                      <span className="truncate">
                        {sourceLabel(trace.source)} {trace.sourceTraceId.slice(0, 8)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <ListCell title={trace.serviceName || "local"}>
                  {trace.serviceName || "local"}
                </ListCell>
                <ListCell align="right">
                  {formatDuration(trace.durationMs)}
                </ListCell>
                <ListCell align="right">
                  {trace.spanCount}
                  <span className="ml-1 text-muted-foreground/70">
                    · {trace.llmSpanCount} LLM
                  </span>
                </ListCell>
                <ListCell align="right">{trace.totalTokens ?? 0}</ListCell>
                <ListCell className="pl-4">
                  {formatTimestamp(trace.startTime)}
                </ListCell>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-1 py-3 text-xs text-muted-foreground">
          <span>Showing {traces.length} traces</span>
          <span>{totalCount} matching traces</span>
        </div>
      </div>
    </div>
  );
}

export function ListCell({
  align,
  children,
  className,
  title,
}: {
  align?: "left" | "right";
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center text-sm tabular-nums text-muted-foreground",
        align === "right" && "justify-end text-right",
        className,
      )}
      title={title}
    >
      <span className="truncate">{children}</span>
    </div>
  );
}
