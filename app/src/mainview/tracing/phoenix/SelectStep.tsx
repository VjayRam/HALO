import { Activity, Layers3, MessageSquare } from "lucide-react";

import { cn } from "~/lib/ui";
import { FilterSelect, type FilterSelectOption } from "~/components/FilterSelect";
import { StatTile } from "~/components/StatTile";
import type {
  PhoenixImportPreview,
  PhoenixProjectFacet,
} from "../../../server/phoenix/types";
import { type DatePreset } from "../langfuse/shared";

export function SelectStep({
  datePreset,
  onDatePresetChange,
  onProjectChange,
  preview,
  previewError,
  previewFetching,
  previewLoading,
  projectId,
  projects,
}: {
  datePreset: DatePreset;
  onDatePresetChange: (value: DatePreset) => void;
  onProjectChange: (projectId: string) => void;
  preview: PhoenixImportPreview | undefined;
  previewError: boolean;
  previewFetching: boolean;
  previewLoading: boolean;
  projectId: string;
  projects: PhoenixProjectFacet[];
}) {
  const projectOptions: FilterSelectOption[] = projects.map((project) => ({
    count: project.traceCount ?? undefined,
    label: project.name,
    value: project.id,
  }));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div
          className={cn(
            "flex gap-2 transition-opacity duration-200",
            previewFetching && !previewLoading && "opacity-60",
          )}
        >
          <StatTile
            detail={matchedRangeLabel(preview) ?? "matching your filters"}
            icon={<Activity />}
            label="Traces"
            loading={previewLoading}
            value={previewValue(preview?.traces, false, previewError)}
          />
          <StatTile
            detail={
              preview?.sessionsEstimated ? "estimated from sample" : "distinct sessions"
            }
            icon={<MessageSquare />}
            label="Sessions"
            loading={previewLoading}
            value={previewValue(
              preview?.sessions,
              preview?.sessionsEstimated ?? false,
              previewError,
            )}
          />
          <StatTile
            detail={
              preview?.observationsEstimated ? "estimated from sample" : "all matching"
            }
            icon={<Layers3 />}
            label="Spans"
            loading={previewLoading}
            value={previewValue(
              preview?.observations,
              preview?.observationsEstimated ?? false,
              previewError,
            )}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {previewCaption(preview, previewError, Boolean(projectId))}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FilterSelect
          label="Project"
          onChange={onProjectChange}
          options={projectOptions}
          placeholder="Choose a Phoenix project"
          value={projectId}
        />
        <FilterSelect
          label="Time window"
          onChange={(value) => onDatePresetChange(value as DatePreset)}
          options={[
            { label: "Last 24 hours", value: "24h" },
            { label: "Last 7 days", value: "7d" },
            { label: "Last 30 days", value: "30d" },
            { label: "All time", value: "all" },
          ]}
          value={datePreset}
        />
      </div>
    </div>
  );
}

function previewValue(
  value: number | undefined,
  estimated: boolean,
  error: boolean,
) {
  if (error || value == null) return "—";
  return `${estimated ? "≈" : ""}${value.toLocaleString()}`;
}

/** "May 12 – Jun 11" span of the traces matching the current filters. */
function matchedRangeLabel(preview: PhoenixImportPreview | undefined) {
  if (!preview?.earliestTimestamp || !preview.latestTimestamp) return null;
  const format = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  const earliest = format(preview.earliestTimestamp);
  const latest = format(preview.latestTimestamp);
  return earliest === latest ? earliest : `${earliest} – ${latest}`;
}

function previewCaption(
  preview: PhoenixImportPreview | undefined,
  error: boolean,
  hasProject: boolean,
) {
  if (!hasProject) return "Choose a Phoenix project to see live counts.";
  if (error) {
    return "Couldn't load live counts from Phoenix — you can still start the import.";
  }
  if (!preview) return "Counts update as you adjust the filters below.";
  if (preview.traces === 0) {
    return "No traces match these filters — widen the time window or pick another project.";
  }
  if (preview.sessionsEstimated || preview.observationsEstimated) {
    return "Counts marked ≈ are estimated from a sample and update as you adjust filters.";
  }
  return "Everything matching these filters will be imported. Counts update as you adjust filters.";
}
