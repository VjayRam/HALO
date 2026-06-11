import { Loader2, MessageSquare } from "lucide-react";

import { Badge, EmptyState, cn } from "~/lib/ui";
import { formatTimestamp, shortId, shortList } from "~/lib/format";
import { showDesktopRowContextMenu } from "~/desktop/desktopBridge";
import type { SessionSummary } from "../../server/telemetry/types";
import { SessionSourceBadge } from "./SourceBadges";
import { ListCell } from "./TraceList";

const GRID_COLS =
  "grid-cols-[minmax(240px,1.4fr)_minmax(110px,0.6fr)_80px_110px_90px_150px]";

export function SessionList({
  activeSessionId,
  isLoading,
  onSelectSession,
  recentSessionIds,
  sessions,
  totalCount,
}: {
  activeSessionId?: string;
  isLoading: boolean;
  onSelectSession: (sessionId: string) => void;
  recentSessionIds: Set<string>;
  sessions: SessionSummary[];
  totalCount: number;
}) {
  if (isLoading && sessions.length === 0) {
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 p-8">
        <EmptyState
          className="w-full self-center"
          description="Sessions appear when traces include a session ID. Traces without one stay hidden here."
          icon={MessageSquare}
          title="No sessions yet"
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
            <div>Session</div>
            <div>Services</div>
            <div className="text-right">Turns</div>
            <div className="text-right">Spans</div>
            <div className="text-right">Tokens</div>
            <div className="pl-4">Last activity</div>
          </div>
          <div>
            {sessions.map((session) => (
              <button
                className={cn(
                  "grid w-full items-center border-b border-border/40 px-4 py-3 text-left transition last:rounded-b-xl last:border-b-0 hover:bg-muted/50",
                  GRID_COLS,
                  activeSessionId === session.sessionId && "bg-muted",
                  recentSessionIds.has(session.sessionId) && "live-trace-flash",
                )}
                key={session.sessionId}
                onClick={() => onSelectSession(session.sessionId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void showDesktopRowContextMenu({
                    id: session.sessionId,
                    kind: "session",
                  });
                }}
                type="button"
              >
                <div className="min-w-0 pr-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        session.hasError
                          ? "bg-detail-failure"
                          : "bg-detail-success",
                      )}
                      title={session.hasError ? "error" : "ok"}
                    />
                    <span className="truncate text-sm font-medium">
                      {session.latestTraceName || "session"}
                    </span>
                    {recentSessionIds.has(session.sessionId) ? (
                      <Badge size="sm" variant="status-brand">
                        live
                      </Badge>
                    ) : null}
                    <SessionSourceBadge session={session} />
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground">
                    <span className="font-mono" title={session.sessionId}>
                      {shortId(session.sessionId, 20)}
                    </span>
                    {session.agentNames[0] ? (
                      <span
                        className="max-w-40 truncate"
                        title={session.agentNames[0]}
                      >
                        {session.agentNames[0]}
                      </span>
                    ) : null}
                    {session.llmModelNames[0] ? (
                      <span className="truncate">{session.llmModelNames[0]}</span>
                    ) : null}
                  </div>
                </div>
                <ListCell title={shortList(session.serviceNames, "local")}>
                  {shortList(session.serviceNames, "local")}
                </ListCell>
                <ListCell align="right">{session.traceCount}</ListCell>
                <ListCell align="right">
                  {session.spanCount}
                  <span className="ml-1 text-muted-foreground/70">
                    · {session.llmSpanCount} LLM
                  </span>
                </ListCell>
                <ListCell align="right">{session.totalTokens ?? 0}</ListCell>
                <ListCell className="pl-4">
                  {formatTimestamp(session.endTime)}
                </ListCell>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-1 py-3 text-xs text-muted-foreground">
          <span>Showing {sessions.length} sessions</span>
          <span>{totalCount} matching sessions</span>
        </div>
      </div>
    </div>
  );
}
