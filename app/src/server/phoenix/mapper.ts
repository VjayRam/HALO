import { createHash } from "node:crypto";
import type {
  OtlpAnyValue,
  OtlpExportTraceServiceRequest,
  OtlpKeyValue,
} from "../telemetry/otlp";
import type { PhoenixSpan, PhoenixTraceWithSpans } from "./types";

type OtlpSpanInput = {
  attributes: OtlpKeyValue[];
  endTimeUnixNano: string;
  events?: Array<{
    attributes: OtlpKeyValue[];
    name: string;
    timeUnixNano: string;
  }>;
  kind: string;
  name: string;
  parentSpanId?: string;
  spanId: string;
  startTimeUnixNano: string;
  status: { code: string; message?: string };
  traceId: string;
};

export type PhoenixImportContext = {
  baseUrl?: string;
  connectionId?: string;
  connectionName?: string;
  importedAt?: Date | number | string;
  importJobId?: string;
  projectId?: string;
  projectName?: string;
};

export function phoenixTraceToOtlp(
  trace: PhoenixTraceWithSpans,
  context: PhoenixImportContext = {},
): OtlpExportTraceServiceRequest {
  const traceId = toOtelTraceId(trace.trace_id || trace.id);
  const spans = [...(trace.spans ?? [])].sort((a, b) => {
    const at = Date.parse(a.start_time ?? trace.start_time ?? "");
    const bt = Date.parse(b.start_time ?? trace.start_time ?? "");
    return (Number.isFinite(at) ? at : 0) - (Number.isFinite(bt) ? bt : 0);
  });
  const outputs: OtlpSpanInput[] = [];

  if (spans.length === 0) {
    const rootStart = dateToNano(trace.start_time);
    outputs.push({
      attributes: [
        ...traceMetadataAttributes(trace, context),
        ...compactAttributes({
          "agent.name": traceAgentName(trace, context),
          "openinference.span.kind": "AGENT",
        }),
      ],
      endTimeUnixNano: dateToNano(trace.end_time ?? trace.start_time),
      kind: "SPAN_KIND_INTERNAL",
      name: "Phoenix trace",
      spanId: toOtelSpanId(`halo-root:${trace.trace_id || trace.id}`),
      startTimeUnixNano: rootStart,
      status: { code: "STATUS_CODE_OK", message: "" },
      traceId,
    });
  }

  const knownSpanIds = new Set(
    spans
      .map((span) => span.context?.span_id?.trim().toLowerCase())
      .filter((id): id is string => Boolean(id)),
  );

  for (const span of spans) {
    const spanId = span.context?.span_id
      ? toOtelSpanId(span.context.span_id)
      : toOtelSpanId(span.id);
    const kind = observationKind(span);
    // Phoenix reports parent ids even when the parent span falls outside the
    // requested window; orphaned references would hide the span from HALO's
    // tree, so only keep parents that exist in this trace payload.
    const parentId = span.parent_id?.trim().toLowerCase();
    const parentSpanId =
      parentId && knownSpanIds.has(parentId) ? toOtelSpanId(parentId) : undefined;
    outputs.push({
      attributes: spanAttributes(span, trace, kind, context),
      endTimeUnixNano: dateToNano(span.end_time ?? span.start_time),
      events: spanEvents(span),
      kind: kind === "LLM" ? "SPAN_KIND_CLIENT" : "SPAN_KIND_INTERNAL",
      name: span.name || kind.toLowerCase() || "span",
      parentSpanId,
      spanId,
      startTimeUnixNano: dateToNano(span.start_time),
      status: spanStatus(span),
      traceId,
    });
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: compactAttributes({
            "service.name": context.projectName ?? "phoenix-import",
          }),
        },
        scopeSpans: [
          {
            scope: {
              name: "phoenix-import",
              version: "1",
            },
            spans: outputs.map((span) => ({
              attributes: span.attributes,
              endTimeUnixNano: span.endTimeUnixNano,
              events: span.events,
              kind: span.kind,
              name: span.name,
              parentSpanId: span.parentSpanId,
              spanId: span.spanId,
              startTimeUnixNano: span.startTimeUnixNano,
              status: span.status,
              traceId: span.traceId,
            })),
          },
        ],
      },
    ],
  };
}

export function toOtelTraceId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (/^[0-9a-f]{32}$/.test(normalized)) return normalized;
  return sha256(normalized).slice(0, 32);
}

export function toOtelSpanId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (/^[0-9a-f]{16}$/.test(normalized)) return normalized;
  return sha256(normalized).slice(0, 16);
}

export function phoenixTraceUrl(
  context: Pick<PhoenixImportContext, "baseUrl" | "projectId">,
  traceId: string | null | undefined,
): string | undefined {
  if (!context.baseUrl || !context.projectId || !traceId) return undefined;
  const base = context.baseUrl.replace(/\/+$/, "");
  return `${base}/projects/${encodeURIComponent(context.projectId)}/traces/${encodeURIComponent(traceId)}`;
}

function traceMetadataAttributes(
  trace: PhoenixTraceWithSpans,
  context: PhoenixImportContext,
): OtlpKeyValue[] {
  const sourceTraceId = trace.trace_id || trace.id;
  const sourceUrl = phoenixTraceUrl(context, sourceTraceId);
  return compactAttributes({
    "halo.source": "phoenix",
    "halo.source.connection_id": context.connectionId,
    "halo.source.connection_name": context.connectionName,
    "halo.source.import_job_id": context.importJobId,
    "halo.source.imported_at": importedAtIso(context.importedAt),
    "halo.source.trace_id": sourceTraceId,
    "halo.source.url": sourceUrl,
    "phoenix.project.id": context.projectId ?? trace.project_id,
    "phoenix.project.name": context.projectName,
    "phoenix.trace.id": sourceTraceId,
    "phoenix.trace.url": sourceUrl,
  });
}

function spanAttributes(
  span: PhoenixSpan,
  trace: PhoenixTraceWithSpans,
  kind: string,
  context: PhoenixImportContext,
): OtlpKeyValue[] {
  // Phoenix returns OpenInference attributes as flat dot-path keys, which is
  // exactly what HALO's ingest expects — pass them through verbatim and only
  // layer the provenance + span-kind attributes on top.
  const passthrough = asRecord(span.attributes);
  const attrs = [
    ...traceMetadataAttributes(trace, context),
    ...compactAttributes(passthrough),
    ...compactAttributes({
      "agent.name": traceAgentName(trace, context),
      "phoenix.span.id": span.id,
    }),
  ];
  if (!("openinference.span.kind" in passthrough)) {
    attrs.push(...compactAttributes({ "openinference.span.kind": kind }));
  }
  return attrs;
}

function spanEvents(span: PhoenixSpan) {
  const events = span.events ?? [];
  if (events.length === 0) return undefined;
  return events.map((event) => ({
    attributes: compactAttributes(asRecord(event.attributes)),
    name: event.name ?? "event",
    timeUnixNano: dateToNano(event.timestamp ?? span.start_time),
  }));
}

const OBSERVATION_KINDS = new Set([
  "AGENT",
  "CHAIN",
  "EMBEDDING",
  "EVALUATOR",
  "GUARDRAIL",
  "LLM",
  "PROMPT",
  "RERANKER",
  "RETRIEVER",
  "TOOL",
]);

function observationKind(span: PhoenixSpan): string {
  const kind = span.span_kind?.toUpperCase() ?? "";
  if (OBSERVATION_KINDS.has(kind)) return kind;
  return "SPAN";
}

function spanStatus(span: PhoenixSpan) {
  const code = span.status_code?.toUpperCase() ?? "";
  if (code === "ERROR") {
    return {
      code: "STATUS_CODE_ERROR",
      message: span.status_message ?? "",
    };
  }
  if (code === "OK") {
    return { code: "STATUS_CODE_OK", message: span.status_message ?? "" };
  }
  return { code: "STATUS_CODE_UNSET", message: span.status_message ?? "" };
}

function traceAgentName(
  trace: PhoenixTraceWithSpans,
  context: PhoenixImportContext,
): string {
  const root = (trace.spans ?? []).find((span) => !span.parent_id);
  return root?.name || context.projectName || "Phoenix trace";
}

function compactAttributes(values: Record<string, unknown>): OtlpKeyValue[] {
  return Object.entries(values)
    .map(([key, value]) => attribute(key, value))
    .filter((value): value is OtlpKeyValue => value != null);
}

function attribute(key: string, value: unknown): OtlpKeyValue | null {
  const encoded = anyValue(value);
  return encoded ? { key, value: encoded } : null;
}

function anyValue(value: unknown): OtlpAnyValue | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
  }
  if (typeof value === "bigint") return { intValue: value.toString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(anyValue).filter(Boolean) as OtlpAnyValue[] } };
  }
  if (typeof value === "string") return { stringValue: value };
  return { stringValue: valueAsString(value) };
}

function valueAsString(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function importedAtIso(value: PhoenixImportContext["importedAt"]): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dateToNano(value: string | null | undefined): string {
  const parsed = Date.parse(value ?? "");
  const ms = Number.isFinite(parsed) ? parsed : Date.now();
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
