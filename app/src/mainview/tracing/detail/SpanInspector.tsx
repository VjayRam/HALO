import { useMemo, useState, type ReactNode } from "react";
import { Braces, MessageSquare } from "lucide-react";

import { Badge, Separator, Tabs, TabsList, TabsTrigger, cn } from "~/lib/ui";
import { formatDuration, formatMoney, kindVariant, prettyMaybeJson } from "~/lib/format";
import type { Span, Trace } from "../../../server/telemetry/types";
import { parseSpanConversation } from "../llmMessages";
import { isSyntheticSpan } from "../spanTree";
import { LlmSpanView } from "./LlmSpanView";
import { syntheticBadgeLabel } from "./spanUtils";

export function SpanInspector({
  span,
  trace,
}: {
  span: Span | null;
  trace: Trace | null;
}) {
  if (!span) {
    return (
      <div className="grid min-h-full place-items-center p-6 text-muted-foreground">
        Select a span to inspect it.
      </div>
    );
  }

  return <SpanInspectorContent span={span} trace={trace} />;
}

function SpanInspectorContent({
  span,
  trace,
}: {
  span: Span;
  trace: Trace | null;
}) {
  const [ioView, setIoView] = useState<"conversation" | "raw">("conversation");
  const conversation = useMemo(() => parseSpanConversation(span), [span]);

  const attributes = {
    resource: span.resourceAttributes,
    span: span.spanAttributes,
    spanDouble: span.spanAttributesDouble,
    spanInt: span.spanAttributesInt,
  };
  const synthetic = isSyntheticSpan(span);
  const showConversation = conversation !== null && ioView === "conversation";

  return (
    <div className="min-w-0 space-y-5 p-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={kindVariant(span.observationKind)}>
            {span.observationKind}
          </Badge>
          {synthetic ? (
            <Badge variant="status-brand">{syntheticBadgeLabel(span)}</Badge>
          ) : null}
          <Badge variant={span.statusCode.includes("ERROR") ? "status-failure" : "outline"}>
            {span.statusCode.replace("STATUS_CODE_", "").toLowerCase()}
          </Badge>
          {span.llmModelName ? <Badge variant="secondary">{span.llmModelName}</Badge> : null}
        </div>
        <h3 className="mt-3 truncate text-xl font-semibold">{span.spanName}</h3>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {span.spanId}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <MiniStat label="Duration" value={formatDuration(span.durationMs)} />
        <MiniStat label="Tokens" value={span.totalTokens ?? 0} />
        <MiniStat label="Cost" value={formatMoney(Number(span.costTotal ?? 0))} />
        <MiniStat label="Service" value={span.serviceName || trace?.serviceName || "local"} />
      </div>

      <Separator />

      <div className="min-w-0">
        {conversation ? (
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Input / Output</p>
            <Tabs
              onValueChange={(value) => {
                if (value === "conversation" || value === "raw") setIoView(value);
              }}
              value={ioView}
            >
              <TabsList className="h-8">
                <TabsTrigger className="gap-1.5 px-2 py-1 text-xs" value="conversation">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Conversation
                </TabsTrigger>
                <TabsTrigger className="gap-1.5 px-2 py-1 text-xs" value="raw">
                  <Braces className="h-3.5 w-3.5" />
                  Raw
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}
        {showConversation && conversation ? (
          <LlmSpanView conversation={conversation} />
        ) : (
          <div className={cn("grid gap-4")}>
            <TextBlock
              empty="No captured input"
              label="Input"
              value={span.inputMessages ?? span.input}
            />
            <TextBlock
              empty="No captured output"
              label="Output"
              value={span.outputMessages ?? span.output}
            />
          </div>
        )}
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-4">
        <JsonBlock label="Attributes" value={attributes} />
        <JsonBlock label="Events" value={span.events} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-subtle bg-background-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function TextBlock({
  empty,
  label,
  value,
}: {
  empty: string;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{label}</p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-subtle bg-background-muted p-3 text-xs leading-relaxed">
        {prettyMaybeJson(value) || empty}
      </pre>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-semibold">{label}</p>
      <pre className="max-h-72 overflow-auto rounded-md border border-subtle bg-background-muted p-3 text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
