import {
  Activity,
  CircleDollarSign,
  Code2,
  Layers3,
  MessageSquare,
  XCircle,
  Zap,
} from "lucide-react";

import { StatStrip, StatTile } from "~/components/StatTile";
import { cn } from "~/lib/ui";
import { compactNumber, formatMoney } from "~/lib/format";

export function TelemetryStatStrip({
  errorCount,
  isLoading,
  llmSpanCount,
  mode,
  sessionCount,
  spanCount,
  totalCost,
  totalTokens,
  traceCount,
}: {
  errorCount: number;
  isLoading: boolean;
  llmSpanCount: number;
  mode: "traces" | "sessions";
  sessionCount?: number;
  spanCount: number;
  totalCost: number;
  totalTokens: number;
  traceCount: number;
}) {
  return (
    <StatStrip>
      {mode === "sessions" ? (
        <StatTile
          icon={<MessageSquare />}
          label="Sessions"
          loading={isLoading}
          value={sessionCount ?? 0}
        />
      ) : null}
      <StatTile
        icon={<Activity />}
        label={mode === "sessions" ? "Turns" : "Traces"}
        loading={isLoading}
        value={traceCount}
      />
      <StatTile
        icon={<Layers3 />}
        label="Spans"
        loading={isLoading}
        value={spanCount}
      />
      <StatTile
        icon={<Code2 />}
        label="LLM spans"
        loading={isLoading}
        value={llmSpanCount}
      />
      <StatTile
        className={cn(errorCount > 0 && "border-detail-failure/40")}
        icon={<XCircle />}
        label="Errors"
        loading={isLoading}
        value={
          <span className={cn(errorCount > 0 && "text-detail-failure")}>
            {errorCount}
          </span>
        }
      />
      <StatTile
        icon={<Zap />}
        label="Tokens"
        loading={isLoading}
        value={compactNumber(totalTokens)}
      />
      <StatTile
        icon={<CircleDollarSign />}
        label="Cost"
        loading={isLoading}
        value={formatMoney(totalCost)}
      />
    </StatStrip>
  );
}
