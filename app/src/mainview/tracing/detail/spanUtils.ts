import type { Span } from "../../../server/telemetry/types";
import { isSessionTraceGroupSpan } from "../spanTree";

export function spanKey(span: Span) {
  return `${span.traceId}:${span.spanId}`;
}

export function syntheticBadgeLabel(span: Span) {
  return isSessionTraceGroupSpan(span) ? "turn" : "pending";
}

export function upsertSpan(spans: Span[], span: Span) {
  const index = spans.findIndex((item) => spanKey(item) === spanKey(span));
  const next = [...spans];
  if (index === -1) next.push(span);
  else next[index] = span;
  return next.sort((a, b) =>
    a.startTimeMs === b.startTimeMs
      ? a.spanId.localeCompare(b.spanId)
      : a.startTimeMs - b.startTimeMs,
  );
}
