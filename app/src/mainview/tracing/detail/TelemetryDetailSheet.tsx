import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Braces, Code2, ListTree, Loader2 } from "lucide-react";

import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/lib/ui";
import { trpc } from "~/trpc";
import { relativeTime } from "~/lib/format";
import type { Span } from "../../../server/telemetry/types";
import {
  buildClientSpanTree,
  buildSessionSpanTree,
  findFirstInspectableSpan,
  flattenSpanTree,
  isSessionTraceGroupSpan,
  isSyntheticSpan,
} from "../spanTree";
import { SessionSourceBadge, TraceSourceBadge } from "../SourceBadges";
import { SpanInspector } from "./SpanInspector";
import { SpanTreeList } from "./SpanTreeList";
import { Timeline } from "./Timeline";
import { spanKey, upsertSpan } from "./spanUtils";

const EMPTY_SPANS: Span[] = [];

type DetailTab = "tree" | "timeline" | "span" | "raw";

export function TelemetryDetailSheet({
  followLatest,
  mode,
  onOpenChange,
  open,
  sessionId,
  traceId,
}: {
  followLatest?: boolean;
  mode: "trace" | "session";
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sessionId?: string;
  traceId?: string;
}) {
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("tree");
  const [selectedSpanKey, setSelectedSpanKey] = useState<string | null>(null);
  const [recentSpanIds, setRecentSpanIds] = useState<Set<string>>(() => new Set());
  const recentSpanTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const detailTraceInput = useMemo(() => ({ traceId: traceId ?? "" }), [traceId]);
  const detailSpansInput = useMemo(
    () => ({ limit: 500, traceId: traceId ?? "" }),
    [traceId],
  );
  const detailSessionInput = useMemo(
    () => ({ sessionId: sessionId ?? "" }),
    [sessionId],
  );
  const detailSessionSpansInput = useMemo(
    () => ({ limit: 1000, sessionId: sessionId ?? "" }),
    [sessionId],
  );
  const detailSessionTracesInput = useMemo(
    () => ({ limit: 500, sessionId: sessionId ?? "" }),
    [sessionId],
  );
  const utils = trpc.useUtils();
  const traceQuery = trpc.traces.get.useQuery(detailTraceInput, {
    enabled: mode === "trace" && open && Boolean(traceId),
  });
  const spansQuery = trpc.traces.getSpans.useQuery(detailSpansInput, {
    enabled: mode === "trace" && open && Boolean(traceId),
  });
  const sessionQuery = trpc.sessions.get.useQuery(detailSessionInput, {
    enabled: mode === "session" && open && Boolean(sessionId),
  });
  const sessionSpansQuery = trpc.sessions.getSpans.useQuery(detailSessionSpansInput, {
    enabled: mode === "session" && open && Boolean(sessionId),
  });
  const sessionTracesQuery = trpc.sessions.getTraces.useQuery(detailSessionTracesInput, {
    enabled: mode === "session" && open && Boolean(sessionId),
  });

  const markRecentSpanId = useCallback((span: Span) => {
    const key = spanKey(span);
    setRecentSpanIds((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    const existing = recentSpanTimers.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      recentSpanTimers.current.delete(key);
      setRecentSpanIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }, 2_200);
    recentSpanTimers.current.set(key, timer);
  }, []);

  trpc.live.trace.useSubscription(detailTraceInput, {
    enabled: mode === "trace" && open && Boolean(traceId),
    onData(eventEnvelope) {
      const event = eventEnvelope.data;
      if (!traceId) return;
      if (event.payload.type === "span.upserted") {
        const span = event.payload.span;
        if (span.traceId !== traceId) return;
        markRecentSpanId(span);
        utils.traces.getSpans.setData(detailSpansInput, (current) => {
          if (!current) return current;
          const spans = upsertSpan(current.spans, span);
          return {
            ...current,
            spans,
            tree: buildClientSpanTree(spans),
          };
        });
        return;
      }
      if (
        event.payload.type === "trace.upserted" &&
        event.payload.trace.traceId === traceId
      ) {
        utils.traces.get.setData(detailTraceInput, event.payload.trace);
      }
    },
  });

  trpc.live.workspace.useSubscription(undefined, {
    enabled: mode === "session" && open && Boolean(sessionId),
    onData(eventEnvelope) {
      const event = eventEnvelope.data;
      if (!sessionId) return;
      const traceIds = new Set(
        sessionTracesQuery.data?.traces.map((trace) => trace.traceId) ?? [],
      );
      if (event.payload.type === "span.upserted") {
        const span = event.payload.span;
        if (span.sessionId !== sessionId && !traceIds.has(span.traceId)) return;
        markRecentSpanId(span);
        void utils.sessions.getSpans.invalidate(detailSessionSpansInput);
        void utils.sessions.get.invalidate(detailSessionInput);
        void utils.sessions.getTraces.invalidate(detailSessionTracesInput);
      }
      if (event.payload.type === "trace.upserted") {
        const trace = event.payload.trace;
        if (trace.sessionId !== sessionId && !traceIds.has(trace.traceId)) return;
        void utils.sessions.get.invalidate(detailSessionInput);
        void utils.sessions.getSpans.invalidate(detailSessionSpansInput);
        void utils.sessions.getTraces.invalidate(detailSessionTracesInput);
      }
    },
  });

  useEffect(
    () => () => {
      for (const timer of recentSpanTimers.current.values()) {
        clearTimeout(timer);
      }
    },
    [],
  );

  useEffect(() => {
    setSelectedSpanKey(null);
    setRecentSpanIds(new Set());
  }, [sessionId, traceId]);

  const spans =
    mode === "session"
      ? (sessionSpansQuery.data?.spans ?? EMPTY_SPANS)
      : (spansQuery.data?.spans ?? EMPTY_SPANS);
  const sessionTraces = sessionTracesQuery.data?.traces ?? [];
  const displayTree = useMemo(
    () =>
      mode === "session"
        ? buildSessionSpanTree(spans, sessionTraces)
        : buildClientSpanTree(spans),
    [mode, sessionTraces, spans],
  );
  const displaySpans = useMemo(() => flattenSpanTree(displayTree), [displayTree]);
  const firstInspectableSpan = useMemo(
    () => findFirstInspectableSpan(displayTree) ?? displaySpans[0] ?? null,
    [displaySpans, displayTree],
  );
  const firstInspectableSpanKey = firstInspectableSpan
    ? spanKey(firstInspectableSpan)
    : null;
  const timelineSpans = useMemo(
    () =>
      mode === "session"
        ? displaySpans.filter((span) => !isSessionTraceGroupSpan(span))
        : displaySpans,
    [displaySpans, mode],
  );

  useEffect(() => {
    if (!open) {
      setSelectedSpanKey(null);
      setRecentSpanIds(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (open && firstInspectableSpanKey && !selectedSpanKey) {
      setSelectedSpanKey(firstInspectableSpanKey);
    }
  }, [firstInspectableSpanKey, open, selectedSpanKey]);

  const selectedSpanCandidate =
    displaySpans.find((span) => spanKey(span) === selectedSpanKey) ?? null;
  const selectedSpan =
    selectedSpanCandidate && !isSessionTraceGroupSpan(selectedSpanCandidate)
      ? selectedSpanCandidate
      : (firstInspectableSpan ?? null);
  const session = sessionQuery.data ?? null;
  const traceMap = useMemo(
    () => new Map(sessionTraces.map((trace) => [trace.traceId, trace])),
    [sessionTraces],
  );
  const trace =
    mode === "session"
      ? selectedSpan
        ? (traceMap.get(selectedSpan.traceId) ?? null)
        : null
      : (traceQuery.data ?? null);
  const waitingForLatest = mode === "trace" && followLatest && !traceId;
  const rootSpan = displayTree[0]?.span ?? null;
  const title =
    waitingForLatest
      ? "Waiting for next trace..."
      : mode === "session"
        ? (session?.latestTraceName || "Session detail")
      : rootSpan && isSyntheticSpan(rootSpan)
        ? rootSpan.spanName
        : (trace?.rootSpanName ?? rootSpan?.spanName ?? "Trace detail");
  const description =
    mode === "session"
      ? (sessionId ?? "Session")
      : waitingForLatest
        ? "Fire a local request and the sheet will switch automatically."
        : traceId;
  const loading =
    mode === "session"
      ? sessionQuery.isLoading || sessionSpansQuery.isLoading
      : spansQuery.isLoading;

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="flex w-[80vw] max-w-[80vw] flex-col overflow-hidden p-0 max-md:w-[92vw] max-md:max-w-[92vw] sm:max-w-[80vw]"
        side="right"
      >
        <SheetHeader className="border-b border-subtle px-6 py-5 pr-12">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg font-semibold">
                {title}
              </SheetTitle>
              <SheetDescription className="mt-1 truncate font-mono">
                {description}
              </SheetDescription>
              {session ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <SessionSourceBadge session={session} />
                  <span>{session.traceCount} turns</span>
                  <span>{session.spanCount} spans</span>
                  {session.agentNames.slice(0, 2).map((agent) => (
                    <Badge key={agent} size="sm" variant="outline">
                      {agent}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {trace && trace.source !== "local" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <TraceSourceBadge trace={trace} />
                  {trace.sourceConnectionName ? (
                    <span>{trace.sourceConnectionName}</span>
                  ) : null}
                  {trace.sourceImportedAt ? (
                    <span>Imported {relativeTime(trace.sourceImportedAt)}</span>
                  ) : null}
                  {trace.sourceTags.slice(0, 3).map((tag) => (
                    <Badge key={tag} size="sm" variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {mode === "trace" && followLatest ? (
                <Badge className="gap-1.5" variant="status-brand">
                  <Activity className="h-3 w-3 animate-pulse" />
                  Following latest
                </Badge>
              ) : null}
              {session ? (
                <Badge
                  variant={session.hasError ? "status-failure" : "status-success"}
                >
                  {session.hasError ? "error" : "ok"}
                </Badge>
              ) : trace ? (
                <Badge
                  variant={trace.hasError ? "status-failure" : "status-success"}
                >
                  {trace.hasError ? "error" : "ok"}
                </Badge>
              ) : null}
            </div>
          </div>
        </SheetHeader>

        {waitingForLatest ? (
          <WaitingForLatestTrace />
        ) : loading ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs
            className="flex min-h-0 flex-1 flex-col"
            onValueChange={(value) => setActiveDetailTab(value as DetailTab)}
            value={activeDetailTab}
          >
            <div className="border-b border-subtle px-6 py-3">
              <TabsList>
                <TabsTrigger value="tree">
                  <ListTree className="mr-2 h-4 w-4" />
                  Tree
                </TabsTrigger>
                <TabsTrigger value="timeline">
                  <Activity className="mr-2 h-4 w-4" />
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="span">
                  <Braces className="mr-2 h-4 w-4" />
                  Span
                </TabsTrigger>
                <TabsTrigger value="raw">
                  <Code2 className="mr-2 h-4 w-4" />
                  Raw
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent className="min-h-0 flex-1 overflow-auto p-0" value="tree">
              <div className="grid min-h-full grid-cols-[360px_minmax(0,1fr)]">
                <div className="border-r border-subtle p-4">
                  <SpanTreeList
                    nodes={displayTree}
                    onSelectSpan={setSelectedSpanKey}
                    recentSpanIds={recentSpanIds}
                    selectedSpanId={selectedSpan ? spanKey(selectedSpan) : undefined}
                  />
                </div>
                <SpanInspector span={selectedSpan} trace={trace} />
              </div>
            </TabsContent>

            <TabsContent className="min-h-0 flex-1 overflow-auto p-6" value="timeline">
              <Timeline recentSpanIds={recentSpanIds} spans={timelineSpans} />
            </TabsContent>

            <TabsContent className="min-h-0 flex-1 overflow-auto p-0" value="span">
              <SpanInspector span={selectedSpan} trace={trace} />
            </TabsContent>

            <TabsContent className="min-h-0 flex-1 overflow-auto p-6" value="raw">
              <pre className="overflow-auto rounded-md border border-subtle bg-background-muted p-4 text-xs">
                {JSON.stringify({ session, spans, trace, traces: sessionTraces }, null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function WaitingForLatestTrace() {
  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="max-w-md rounded-xl border border-dashed border-subtle bg-background-muted p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-subtle bg-background">
          <Activity className="h-5 w-5 animate-pulse text-detail-brand" />
        </div>
        <h3 className="mt-5 text-lg font-semibold">Waiting for next trace</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep this sheet open and fire a local request. The newest trace will
          appear here as soon as its first span is ingested.
        </p>
      </div>
    </div>
  );
}
