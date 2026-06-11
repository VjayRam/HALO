import { BrainCircuit, Loader2, Square } from "lucide-react";

import { Button, EmptyState, cn } from "~/lib/ui";
import { ProgressBar, StatusBadge } from "~/components/StatusBadge";
import { targetLabel, type HaloRunView } from "./runShared";

export function RunList({
  activeRunId,
  isLoading,
  onCancel,
  onSelect,
  runs,
}: {
  activeRunId?: string;
  isLoading: boolean;
  onCancel: (runId: string) => void;
  onSelect: (runId: string) => void;
  runs: HaloRunView[];
}) {
  if (isLoading) {
    return (
      <div className="grid min-h-80 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="grid min-h-80 place-items-center p-6">
        <EmptyState
          className="w-full border-none"
          description="Configure a provider, pick a trace group, and start your first analysis."
          icon={BrainCircuit}
          title="No HALO runs yet"
        />
      </div>
    );
  }
  return (
    <div className="divide-y divide-subtle">
      {runs.map((run) => {
        const active = ["queued", "exporting", "running"].includes(run.status);
        return (
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_120px_96px] items-center gap-3 p-4 transition hover:bg-muted/40",
              activeRunId === run.id && "bg-muted",
            )}
            key={run.id}
          >
            <button
              className="min-w-0 text-left"
              onClick={() => onSelect(run.id)}
              type="button"
            >
              <div className="flex min-w-0 items-center gap-2">
                <StatusBadge status={run.status} />
                <p className="truncate font-medium">{run.title}</p>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {targetLabel(run.targetType)} · {run.traceCount} traces ·{" "}
                {run.spanCount} spans · {run.providerName || "provider"}
              </p>
            </button>
            <ProgressBar value={run.progress} />
            <div className="flex justify-end gap-1">
              {active ? (
                <Button
                  onClick={() => onCancel(run.id)}
                  size="icon"
                  variant="ghost"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : null}
              <Button onClick={() => onSelect(run.id)} size="sm" variant="outline">
                Open
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
