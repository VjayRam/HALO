import {
  Activity,
  Ban,
  CheckCircle2,
  Clock3,
  Layers3,
  Loader2,
  XCircle,
} from "lucide-react";

import { Badge, cn } from "~/lib/ui";
import { StatTile } from "~/components/StatTile";
import { formatTimestamp } from "~/lib/format";
import type { LangfuseImportJob } from "../../../server/langfuse/types";

/**
 * Progress fields shared by every import integration (Langfuse, Phoenix),
 * so this step renders any provider's job.
 */
export type ImportJobProgress = Pick<
  LangfuseImportJob,
  | "currentTraceId"
  | "currentTraceName"
  | "errorMessage"
  | "failedTraces"
  | "finishedAt"
  | "importedObservations"
  | "importedTraces"
  | "progress"
  | "status"
  | "totalTraces"
  | "updatedAt"
>;

export function ImportProgressStep({
  job,
  providerLabel = "Langfuse",
}: {
  job: ImportJobProgress | null | undefined;
  providerLabel?: string;
}) {
  if (!job) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const active = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed" || job.status === "interrupted";
  const cancelled = job.status === "cancelled";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-subtle bg-background-muted p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ImportStatusIcon status={job.status} />
              <h3 className="text-lg font-semibold">{statusTitle(job.status)}</h3>
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {activityLine(job, providerLabel)}
            </p>
          </div>
          <Badge
            variant={
              failed ? "status-failure" : active ? "status-running" : "outline"
            }
          >
            {job.status}
          </Badge>
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              failed
                ? "bg-detail-failure"
                : cancelled
                  ? "bg-muted-foreground"
                  : "bg-detail-brand",
            )}
            style={{ width: `${Math.max(2, job.progress)}%` }}
          />
        </div>

        {job.errorMessage && !active ? (
          <div className="mt-4 rounded-md border border-detail-failure/30 bg-detail-failure/10 p-3">
            <p className="text-sm text-detail-failure">{job.errorMessage}</p>
            {failed ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Imports resume where they left off — already-imported traces
                are kept.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <StatTile
            icon={<Activity />}
            label="Traces"
            value={
              job.totalTraces > 0
                ? `${job.importedTraces.toLocaleString()} / ${job.totalTraces.toLocaleString()}`
                : job.importedTraces.toLocaleString()
            }
          />
          <StatTile
            icon={<Layers3 />}
            label="Observations"
            value={job.importedObservations.toLocaleString()}
          />
          <StatTile
            className={cn(job.failedTraces > 0 && "border-detail-failure/40")}
            icon={<XCircle />}
            label="Failures"
            value={
              <span className={cn(job.failedTraces > 0 && "text-detail-failure")}>
                {job.failedTraces.toLocaleString()}
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}

function activityLine(job: ImportJobProgress, providerLabel: string) {
  if (job.status === "queued") return "Waiting in the import queue…";
  if (job.status === "running") {
    // currentTraceId distinguishes a real trace from pipeline status copy.
    if (job.currentTraceId && job.currentTraceName) {
      return `Importing “${job.currentTraceName}”`;
    }
    if (job.currentTraceName) return job.currentTraceName;
    return `Talking to ${providerLabel}…`;
  }
  // Static timestamp — a relative "Xm ago" keeps ticking up forever on the
  // finished screen.
  return `Finished ${formatTimestamp(job.finishedAt ?? job.updatedAt)}`;
}

function ImportStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-detail-success" />;
  if (status === "failed" || status === "interrupted") {
    return <XCircle className="h-5 w-5 text-detail-failure" />;
  }
  if (status === "cancelled") return <Ban className="h-5 w-5 text-muted-foreground" />;
  if (status === "queued") return <Clock3 className="h-5 w-5 text-detail-brand" />;
  return <Loader2 className="h-5 w-5 animate-spin text-detail-brand" />;
}

function statusTitle(status: string) {
  if (status === "completed") return "Import complete";
  if (status === "failed") return "Import failed";
  if (status === "cancelled") return "Import cancelled";
  if (status === "interrupted") return "Import interrupted";
  if (status === "queued") return "Import queued";
  return "Importing traces";
}
