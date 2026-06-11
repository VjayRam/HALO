import { Activity, Layers3, MessageSquare } from "lucide-react";

import { cn } from "~/lib/ui";
import { FilterSelect, type FilterSelectOption } from "~/components/FilterSelect";
import { StatTile } from "~/components/StatTile";
import type { LangfuseImportPreview } from "../../../server/langfuse/types";
import { type DatePreset } from "./shared";

/** Radix Select items cannot use an empty-string value, so "Any" maps to this. */
const ANY_VALUE = "__any__";

type Facet = { count: number; label: string; value: string };

export function SelectStep({
  datePreset,
  discovery,
  environment,
  onDatePresetChange,
  onEnvironmentChange,
  onReleaseChange,
  onSessionIdChange,
  onTagChange,
  onTraceNameChange,
  onUserIdChange,
  onVersionChange,
  preview,
  previewError,
  previewFetching,
  previewLoading,
  release,
  sessionId,
  tag,
  traceName,
  userId,
  version,
}: {
  datePreset: DatePreset;
  discovery:
    | {
        environments: Facet[];
        releases: Facet[];
        sessions: Facet[];
        tags: Facet[];
        traceNames: Facet[];
        users: Facet[];
        versions: Facet[];
      }
    | undefined;
  environment: string;
  onDatePresetChange: (value: DatePreset) => void;
  onEnvironmentChange: (value: string) => void;
  onReleaseChange: (value: string) => void;
  onSessionIdChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onTraceNameChange: (value: string) => void;
  onUserIdChange: (value: string) => void;
  onVersionChange: (value: string) => void;
  preview: LangfuseImportPreview | undefined;
  previewError: boolean;
  previewFetching: boolean;
  previewLoading: boolean;
  release: string;
  sessionId: string;
  tag: string;
  traceName: string;
  userId: string;
  version: string;
}) {
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
            detail={preview?.sessionsEstimated ? "estimated from sample" : "distinct sessions"}
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
            detail={preview?.observationsEstimated ? "estimated from sample" : "all matching"}
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
        <p className="text-xs text-muted-foreground">{previewCaption(preview, previewError)}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
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
        <FacetSelect
          facets={discovery?.environments}
          label="Environment"
          onChange={onEnvironmentChange}
          placeholder="Any environment"
          value={environment}
        />
        <FacetSelect
          facets={discovery?.traceNames}
          label="Trace name"
          onChange={onTraceNameChange}
          placeholder="Any trace name"
          value={traceName}
        />
        <FacetSelect
          facets={discovery?.tags}
          label="Tag"
          onChange={onTagChange}
          placeholder="Any tag"
          value={tag}
        />
        <FacetSelect
          facets={discovery?.users}
          label="User"
          onChange={onUserIdChange}
          placeholder="Any user"
          value={userId}
        />
        <FacetSelect
          facets={discovery?.sessions}
          label="Session"
          onChange={onSessionIdChange}
          placeholder="Any session"
          value={sessionId}
        />
        <FacetSelect
          facets={discovery?.versions}
          label="Version"
          onChange={onVersionChange}
          placeholder="Any version"
          value={version}
        />
        <FacetSelect
          facets={discovery?.releases}
          label="Release"
          onChange={onReleaseChange}
          placeholder="Any release"
          value={release}
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
function matchedRangeLabel(preview: LangfuseImportPreview | undefined) {
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
  preview: LangfuseImportPreview | undefined,
  error: boolean,
) {
  if (error) {
    return "Couldn't load live counts from Langfuse — you can still start the import.";
  }
  if (!preview) return "Counts update as you adjust the filters below.";
  if (preview.traces === 0) {
    return "No traces match these filters — widen the time window or clear a filter.";
  }
  if (preview.sessionsEstimated || preview.observationsEstimated) {
    return `Counts marked ≈ are estimated from the latest ${preview.sampleSize} matching traces and update as you adjust filters.`;
  }
  return "Everything matching these filters will be imported. Counts update as you adjust filters.";
}

/**
 * Langfuse facet dropdown where "" (no filter) maps to a sentinel item so the
 * "Any …" choice stays selectable after picking a concrete value.
 */
function FacetSelect({
  facets,
  label,
  onChange,
  placeholder,
  value,
}: {
  facets: Facet[] | undefined;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const options: FilterSelectOption[] = [
    { label: placeholder, value: ANY_VALUE },
    ...(facets ?? []).map((facet) => ({
      count: facet.count,
      label: facet.label,
      value: facet.value,
    })),
  ];
  return (
    <FilterSelect
      label={label}
      onChange={(next) => onChange(next === ANY_VALUE ? "" : next)}
      options={options}
      value={value || ANY_VALUE}
    />
  );
}
