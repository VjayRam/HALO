import { useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  MessageSquareText,
  Wrench,
} from "lucide-react";

import { Button, JsonComponent, cn, toast } from "~/lib/ui";
import type { HaloRunEvent } from "../../server/halo/types";
import {
  presentHaloAgentStep,
  type HaloAgentConsoleKind,
  type HaloAgentConsoleRow,
} from "./haloAgentConsolePresenter";

/**
 * Condensed agent-step transcript for a single conversation turn. One line
 * per step — icon, tool name, truncated detail, elapsed offset — expandable
 * for the full arguments/output.
 */
export function TurnActivityLog({
  events,
  live,
}: {
  events: HaloRunEvent[];
  live: boolean;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => events.flatMap((event) => presentHaloAgentStep(event)),
    [events],
  );
  const firstCreatedMs = useMemo(() => {
    const times = rows
      .map((row) => Date.parse(row.createdAt))
      .filter((time) => Number.isFinite(time));
    return times.length > 0 ? Math.min(...times) : null;
  }, [rows]);

  // Follow the newest step while the turn is live.
  useEffect(() => {
    if (!live) return;
    const scroller = scrollerRef.current;
    scroller?.scrollTo({ behavior: "smooth", top: scroller.scrollHeight });
  }, [live, rows.length]);

  if (rows.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Waiting for agent steps…
      </p>
    );
  }

  return (
    // ~6 rows visible by default; the rest scroll.
    <div className="max-h-48 overflow-y-auto" ref={scrollerRef}>
      <ol>
        {rows.map((row) => (
          <LogRow
            elapsed={formatElapsed(row.createdAt, firstCreatedMs)}
            expanded={expandedKey === row.key}
            key={row.key}
            onToggle={() =>
              setExpandedKey((current) => (current === row.key ? null : row.key))
            }
            row={row}
          />
        ))}
      </ol>
    </div>
  );
}

function LogRow({
  elapsed,
  expanded,
  onToggle,
  row,
}: {
  elapsed: string;
  expanded: boolean;
  onToggle: () => void;
  row: HaloAgentConsoleRow;
}) {
  return (
    <li className={cn("group log-row-fade", expanded && "bg-background-muted/40")}>
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors hover:bg-background-muted/60 focus-visible:bg-background-muted/60"
        onClick={onToggle}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        )}
        <KindIcon kind={row.kind} />
        <span className="shrink-0 font-mono text-xs font-medium">
          {row.toolName ?? row.title}
        </span>
        {row.kind === "result" ? (
          <span className="shrink-0 text-[11px] text-muted-foreground/70">result</span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {previewFor(row)}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
          {elapsed}
        </span>
      </button>

      {expanded ? <RowDetail row={row} /> : null}
    </li>
  );
}

function RowDetail({ row }: { row: HaloAgentConsoleRow }) {
  return (
    <div className="space-y-2 border-t border-subtle px-3 py-2.5 pl-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>#{row.stepSequence ?? row.sequence}</span>
        <span>{row.agentName}</span>
        {row.depth != null ? <span>depth {row.depth}</span> : null}
        {row.toolCallId ? (
          <span className="font-mono">{shortId(row.toolCallId)}</span>
        ) : null}
        <button
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground transition hover:text-foreground"
          onClick={() => void copyToClipboard(row.copyText)}
          type="button"
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>

      {row.command ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-subtle bg-background px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <span className="select-none">$ </span>
          {row.command}
        </pre>
      ) : null}

      {row.body?.text ? (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-subtle bg-background px-2.5 py-1.5 text-[11px] leading-relaxed">
          {row.body.text}
        </pre>
      ) : null}

      <RawPayload payload={row.rawPayload} />
    </div>
  );
}

function RawPayload({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        className="h-6 px-1.5 text-[11px] text-muted-foreground"
        onClick={() => setOpen((current) => !current)}
        size="xs"
        variant="ghost"
      >
        {open ? "Hide raw payload" : "Raw payload"}
      </Button>
      {open ? (
        <div className="mt-1 max-h-72 overflow-auto rounded-md border border-subtle bg-background p-2 text-xs">
          <JsonComponent collapsed={2} data={payload} />
        </div>
      ) : null}
    </div>
  );
}

function KindIcon({ kind }: { kind: HaloAgentConsoleKind }) {
  if (kind === "call") {
    return <Wrench className="h-3 w-3 shrink-0 text-detail-brand" />;
  }
  if (kind === "result") {
    return <CheckCircle2 className="h-3 w-3 shrink-0 text-detail-success" />;
  }
  if (kind === "message") {
    return <MessageSquareText className="h-3 w-3 shrink-0 text-detail-warning" />;
  }
  return <Braces className="h-3 w-3 shrink-0 text-muted-foreground" />;
}

function previewFor(row: HaloAgentConsoleRow) {
  if (row.kind === "call" && row.command) {
    // The tool name is already on the line; show just the arguments.
    return row.command.replace(/^halo tool \S+\s*/, "");
  }
  if (row.summaries.length > 0) {
    return row.summaries
      .slice(0, 3)
      .map((summary) => `${summary.label.toLowerCase()}: ${summary.value}`)
      .join(" · ");
  }
  if (row.body?.text) return row.body.text.replace(/\s+/g, " ").trim();
  return row.subtitle ?? "";
}

function formatElapsed(createdAt: string, firstCreatedMs: number | null) {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs) || firstCreatedMs == null) return "+0.0s";
  const elapsedMs = Math.max(0, createdMs - firstCreatedMs);
  if (elapsedMs < 1_000) return `+${(elapsedMs / 1000).toFixed(1)}s`;
  if (elapsedMs < 60_000) return `+${(elapsedMs / 1_000).toFixed(1)}s`;
  return `+${Math.floor(elapsedMs / 60_000)}m${Math.round((elapsedMs % 60_000) / 1000)}s`;
}

function shortId(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
  toast.success({ title: "Copied" });
}
