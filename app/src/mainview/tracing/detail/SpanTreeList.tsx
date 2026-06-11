import { ChevronRight } from "lucide-react";

import { Badge, cn } from "~/lib/ui";
import { formatDuration, kindVariant } from "~/lib/format";
import type { SpanNode } from "../../../server/telemetry/types";
import {
  findFirstInspectableSpan,
  isSessionTraceGroupSpan,
  isSyntheticSpan,
} from "../spanTree";
import { spanKey, syntheticBadgeLabel } from "./spanUtils";

export function SpanTreeList({
  nodes,
  onSelectSpan,
  recentSpanIds,
  selectedSpanId,
}: {
  nodes: SpanNode[];
  onSelectSpan: (spanId: string) => void;
  recentSpanIds: Set<string>;
  selectedSpanId?: string;
}) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">No spans found.</p>;
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <SpanTreeNode
          key={spanKey(node.span)}
          node={node}
          onSelectSpan={onSelectSpan}
          recentSpanIds={recentSpanIds}
          selectedSpanId={selectedSpanId}
        />
      ))}
    </div>
  );
}

function SpanTreeNode({
  depth = 0,
  node,
  onSelectSpan,
  recentSpanIds,
  selectedSpanId,
}: {
  depth?: number;
  node: SpanNode;
  onSelectSpan: (spanId: string) => void;
  recentSpanIds: Set<string>;
  selectedSpanId?: string;
}) {
  const key = spanKey(node.span);
  const sessionGroup = isSessionTraceGroupSpan(node.span);
  const inspectableSpan = sessionGroup
    ? findFirstInspectableSpan(node.children)
    : node.span;
  const inspectableKey = inspectableSpan ? spanKey(inspectableSpan) : null;
  const active = selectedSpanId === key;
  const recent = recentSpanIds.has(key);
  const synthetic = isSyntheticSpan(node.span);
  const traceName = node.span.spanAttributes["halo.synthetic.trace_name"];
  return (
    <div>
      <button
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-muted",
          active && !sessionGroup && "bg-muted text-foreground",
          synthetic && "border border-dashed border-detail-brand/30 bg-detail-brand/5",
          recent && "live-span-flash",
        )}
        onClick={() => {
          if (inspectableKey) onSelectSpan(inspectableKey);
        }}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        type="button"
      >
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        <Badge size="sm" variant={kindVariant(node.span.observationKind)}>
          {node.span.observationKind}
        </Badge>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{node.span.spanName}</span>
          {sessionGroup && traceName ? (
            <span className="block truncate text-[11px] text-muted-foreground">
              {traceName}
            </span>
          ) : null}
        </span>
        {synthetic ? (
          <Badge size="sm" variant="outline">
            {syntheticBadgeLabel(node.span)}
          </Badge>
        ) : null}
        {recent ? (
          <span className="h-1.5 w-1.5 rounded-full bg-detail-brand" />
        ) : null}
        <span className="text-xs text-muted-foreground">
          {formatDuration(node.span.durationMs)}
        </span>
      </button>
      {node.children.map((child) => (
        <SpanTreeNode
          depth={depth + 1}
          key={spanKey(child.span)}
          node={child}
          onSelectSpan={onSelectSpan}
          recentSpanIds={recentSpanIds}
          selectedSpanId={selectedSpanId}
        />
      ))}
    </div>
  );
}
