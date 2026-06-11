import { Bunqueue, type Job } from "bunqueue/client";
import type { DatabaseHandle } from "../db/client";
import type { LiveEventStore } from "../live/events";
import type { OtlpExportTraceServiceRequest } from "../telemetry/otlp";
import { ingestTelemetry } from "../telemetry/storage";
import { PhoenixApiClient, PhoenixApiError } from "./client";
import { phoenixTraceToOtlp, type PhoenixImportContext } from "./mapper";
import {
  createPhoenixImportJob,
  getPhoenixConnection,
  getPhoenixImportJob,
  isPhoenixImportCancelled,
  listPhoenixImportJobs,
  markInterruptedPhoenixImports,
  publishPhoenixImportJob,
  updatePhoenixImportJob,
} from "./storage";
import type {
  PhoenixImportJob,
  PhoenixSpan,
  PhoenixTraceFilters,
  PhoenixTraceListItem,
  PhoenixTraceWithSpans,
  StoredPhoenixConnection,
} from "./types";

type ImportJobData = {
  appJobId: string;
};

type ImportJobResult = {
  appJobId: string;
  cancelled?: boolean;
  importedTraces?: number;
};

type PhoenixImportServiceOptions = {
  database: DatabaseHandle;
  live: LiveEventStore;
};

export type PhoenixImportService = ReturnType<typeof createPhoenixImportService>;

const IMPORT_QUEUE_NAME = "phoenix-imports";
const IMPORT_ROUTE = "phoenix.import";
const TRACE_PAGE_LIMIT = 100;
const SPAN_PAGE_LIMIT = 1000;
const SPAN_TRACE_ID_CHUNK_SIZE = 50;
// Self-hosted Phoenix pages can take seconds each on data-heavy endpoints;
// high concurrency just contends with itself until requests start timing out.
const SPAN_CHUNK_CONCURRENCY = 3;
const INGEST_BATCH_TRACE_LIMIT = 250;

export function createPhoenixImportService(options: PhoenixImportServiceOptions) {
  const { database, live } = options;
  markInterruptedPhoenixImports(database.sqlite);

  let queue: Bunqueue<ImportJobData, ImportJobResult>;
  queue = new Bunqueue<ImportJobData, ImportJobResult>(IMPORT_QUEUE_NAME, {
    concurrency: 1,
    dataPath: queueDataPath(database.path),
    heartbeatInterval: 2_000,
    defaultJobOptions: {
      durable: true,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
    dlq: {
      autoRetry: false,
      maxEntries: 500,
    },
    embedded: true,
    retry: {
      delay: 750,
      maxAttempts: 3,
      retryIf: (error) => isTransientImportError(error),
      strategy: "jitter",
    },
    routes: {
      [IMPORT_ROUTE]: async (job) =>
        processImportJob({
          database,
          job,
          live,
          queue,
        }),
    },
  });

  queue.on("failed", (job, error) => {
    const appJobId = job.data.appJobId;
    const current = getPhoenixImportJob(database.sqlite, appJobId);
    if (!current || current.status === "cancelled") return;
    const updated = updatePhoenixImportJob(database.sqlite, appJobId, {
      errorMessage: error.message,
      finishedAt: Date.now(),
      status: "failed",
    });
    publishPhoenixImportJob(live, updated);
  });

  return {
    async cancel(jobId: string) {
      const job = getPhoenixImportJob(database.sqlite, jobId);
      if (!job) return null;
      const updated = updatePhoenixImportJob(database.sqlite, jobId, {
        errorMessage: "Import cancelled by user.",
        finishedAt: Date.now(),
        status: "cancelled",
      });
      publishPhoenixImportJob(live, updated);
      if (job.bunqueueJobId) queue.cancel(job.bunqueueJobId);
      return updated;
    },

    close(force?: boolean) {
      return queue.close(force);
    },

    get(jobId: string) {
      return getPhoenixImportJob(database.sqlite, jobId);
    },

    list(limit?: number) {
      return listPhoenixImportJobs(database.sqlite, limit);
    },

    async start(input: {
      connectionId: string;
      filters: PhoenixTraceFilters;
    }): Promise<PhoenixImportJob> {
      const connection = getPhoenixConnection(database.sqlite, input.connectionId);
      if (!connection) throw new Error("Phoenix connection not found");
      if (!input.filters.projectId && !input.filters.projectName) {
        throw new Error("A Phoenix project is required to import");
      }

      const appJob = createPhoenixImportJob(database.sqlite, input);
      const queued = await queue.add(
        IMPORT_ROUTE,
        { appJobId: appJob.id },
        {
          durable: true,
          jobId: appJob.id,
          priority: 5,
        },
      );
      const updated = updatePhoenixImportJob(database.sqlite, appJob.id, {
        bunqueueJobId: queued.id,
        status: "queued",
      });
      publishPhoenixImportJob(live, updated);
      return updated;
    },
  };
}

async function processImportJob(input: {
  database: DatabaseHandle;
  job: Job<ImportJobData>;
  live: LiveEventStore;
  queue: Bunqueue<ImportJobData, ImportJobResult>;
}): Promise<ImportJobResult> {
  const { database, job, live, queue } = input;
  const appJobId = job.data.appJobId;
  const appJob = getPhoenixImportJob(database.sqlite, appJobId);
  if (!appJob || !["queued", "running"].includes(appJob.status)) {
    return { appJobId, cancelled: true };
  }

  const connection = getPhoenixConnection(database.sqlite, appJob.connectionId);
  if (!connection) {
    throw new Error("Phoenix connection not found");
  }

  const client = new PhoenixApiClient(connection);
  const signal = queue.getSignal(job.id) ?? undefined;
  const counters: ImportCounters = {
    failedTraces: appJob.failedTraces,
    importedObservations: appJob.importedObservations,
    importedTraces: appJob.importedTraces,
    processedTraces: appJob.importedTraces + appJob.failedTraces,
    totalObservations: appJob.totalObservations,
    totalTraces: appJob.totalTraces,
  };
  const context: PhoenixImportContext = {
    baseUrl: connection.baseUrl,
    connectionId: connection.id,
    connectionName: connection.name,
    importedAt: Date.now(),
    importJobId: appJobId,
    projectId: appJob.filters.projectId,
    projectName: appJob.filters.projectName,
  };

  await updateProgress({
    database,
    job,
    live,
    patch: {
      errorMessage: null,
      progress: 1,
      startedAt: Date.now(),
      status: "running",
    },
  });

  try {
    await importProjectTraces({
      appJobId,
      client,
      connection,
      context,
      counters,
      database,
      filters: appJob.filters,
      job,
      live,
      signal,
    });

    const complete = updatePhoenixImportJob(database.sqlite, appJobId, {
      currentTraceId: null,
      currentTraceName: null,
      finishedAt: Date.now(),
      progress: 100,
      status: "completed",
    });
    await job.updateProgress(100, "Import complete");
    publishPhoenixImportJob(live, complete);
    return { appJobId, importedTraces: counters.importedTraces };
  } catch (error) {
    if (
      error instanceof ImportCancelledError ||
      isCancelled(database, appJobId, signal) ||
      isAbortError(error)
    ) {
      await markCancelled({ database, job, live });
      return { appJobId, cancelled: true };
    }
    const message = error instanceof Error ? error.message : "Import failed";
    const failed = updatePhoenixImportJob(database.sqlite, appJobId, {
      errorMessage: message,
      finishedAt: Date.now(),
      status: "failed",
    });
    publishPhoenixImportJob(live, failed);
    throw error;
  }
}

type ImportCounters = {
  failedTraces: number;
  importedObservations: number;
  importedTraces: number;
  processedTraces: number;
  totalObservations: number;
  totalTraces: number;
};

type ImportPipelineInput = {
  appJobId: string;
  client: PhoenixApiClient;
  connection: StoredPhoenixConnection;
  context: PhoenixImportContext;
  counters: ImportCounters;
  database: DatabaseHandle;
  filters: PhoenixTraceFilters;
  job: Job<ImportJobData>;
  live: LiveEventStore;
  signal?: AbortSignal;
};

class ImportCancelledError extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "ImportCancelledError";
  }
}

async function importProjectTraces(input: ImportPipelineInput) {
  const projectIdentifier =
    input.filters.projectId ?? input.filters.projectName ?? "";

  // The Phoenix REST API is cursor-paged with no totals; GraphQL supplies the
  // exact count up front so progress is meaningful. Failures fall back to an
  // incrementing total as pages stream in.
  if (input.filters.projectId) {
    const counts = await input.client.projectCounts(
      {
        fromTimestamp: input.filters.fromTimestamp,
        projectId: input.filters.projectId,
        toTimestamp: input.filters.toTimestamp,
      },
      input.signal,
    );
    if (counts.traceCount != null) {
      input.counters.totalTraces = counts.traceCount;
    }
    if (counts.spanCount != null) {
      input.counters.totalObservations = counts.spanCount;
    }
  }

  await updateCountersProgress(input, {
    progress: progressFor(input.counters.processedTraces, input.counters.totalTraces),
  });

  let cursor: string | null | undefined;
  let seenTraces = 0;
  do {
    assertNotCancelled(input.database, input.appJobId, input.signal);

    const list = await input.client.listTraces(
      {
        cursor,
        filters: input.filters,
        limit: TRACE_PAGE_LIMIT,
        order: "asc",
        projectIdentifier,
      },
      input.signal,
    );
    const traces = list.data ?? [];
    seenTraces += traces.length;
    if (seenTraces > input.counters.totalTraces) {
      input.counters.totalTraces = seenTraces;
    }

    if (traces.length === 0) break;

    const spansByTraceId = await listSpansForTraceIds({
      client: input.client,
      projectIdentifier,
      signal: input.signal,
      traceIds: traces.map((trace) => trace.trace_id),
    });
    const detailedTraces = traces.map((trace) =>
      attachSpans(trace, spansByTraceId),
    );

    await ingestTraceBatches({
      ...input,
      traces: detailedTraces,
    });

    cursor = list.next_cursor ?? null;
  } while (cursor);
}

async function listSpansForTraceIds(input: {
  client: PhoenixApiClient;
  projectIdentifier: string;
  signal?: AbortSignal;
  traceIds: string[];
}) {
  const spansByTraceId = new Map<string, PhoenixSpan[]>();
  const chunks = chunkArray(input.traceIds, SPAN_TRACE_ID_CHUNK_SIZE).filter(
    (chunk) => chunk.length > 0,
  );

  await mapWithConcurrency(chunks, SPAN_CHUNK_CONCURRENCY, async (traceIds) => {
    let cursor: string | null | undefined;
    do {
      const response = await input.client.listSpans(
        {
          cursor,
          limit: SPAN_PAGE_LIMIT,
          projectIdentifier: input.projectIdentifier,
          traceIds,
        },
        input.signal,
      );

      for (const span of response.data ?? []) {
        const traceId = span.context?.trace_id;
        if (!traceId) continue;
        const grouped = spansByTraceId.get(traceId) ?? [];
        grouped.push(span);
        spansByTraceId.set(traceId, grouped);
      }
      cursor = response.next_cursor ?? null;
    } while (cursor);
  });

  return spansByTraceId;
}

function attachSpans(
  trace: PhoenixTraceListItem,
  spansByTraceId: Map<string, PhoenixSpan[]>,
): PhoenixTraceWithSpans {
  return {
    ...trace,
    spans: spansByTraceId.get(trace.trace_id) ?? [],
  };
}

async function ingestTraceBatches(
  input: ImportPipelineInput & { traces: PhoenixTraceWithSpans[] },
) {
  for (
    let start = 0;
    start < input.traces.length;
    start += INGEST_BATCH_TRACE_LIMIT
  ) {
    assertNotCancelled(input.database, input.appJobId, input.signal);
    const batch = input.traces.slice(start, start + INGEST_BATCH_TRACE_LIMIT);
    const currentTrace = batch[0] ?? null;

    await updateCountersProgress(input, {
      currentTraceId: currentTrace?.trace_id ?? null,
      currentTraceName: traceDisplayName(currentTrace),
      progress: progressFor(
        input.counters.processedTraces,
        input.counters.totalTraces,
      ),
    });

    const outcome = ingestTraceBatch(input.database, batch, input.context);
    input.counters.failedTraces += outcome.failedTraces;
    input.counters.importedObservations += outcome.acceptedSpanCount;
    input.counters.importedTraces += outcome.importedTraces;
    input.counters.processedTraces += batch.length;
    input.counters.totalObservations = Math.max(
      input.counters.totalObservations,
      input.counters.importedObservations,
    );

    const lastTrace = batch.at(-1) ?? currentTrace;
    await updateCountersProgress(input, {
      currentTraceId: lastTrace?.trace_id ?? null,
      currentTraceName: traceDisplayName(lastTrace),
      progress: progressFor(
        input.counters.processedTraces,
        input.counters.totalTraces,
      ),
    });
  }
}

function traceDisplayName(trace: PhoenixTraceWithSpans | null): string | null {
  if (!trace) return null;
  const root = trace.spans.find((span) => !span.parent_id) ?? trace.spans[0];
  return root?.name ?? trace.trace_id ?? null;
}

function ingestTraceBatch(
  database: DatabaseHandle,
  traces: PhoenixTraceWithSpans[],
  context: PhoenixImportContext,
) {
  try {
    const result = ingestOtlpPayload(database, traces, context);
    return {
      acceptedSpanCount: result.acceptedSpanCount,
      failedTraces: 0,
      importedTraces: traces.length,
    };
  } catch {
    let acceptedSpanCount = 0;
    let failedTraces = 0;
    let importedTraces = 0;
    for (const trace of traces) {
      try {
        const result = ingestOtlpPayload(database, [trace], context);
        acceptedSpanCount += result.acceptedSpanCount;
        importedTraces += 1;
      } catch {
        failedTraces += 1;
      }
    }
    return { acceptedSpanCount, failedTraces, importedTraces };
  }
}

function ingestOtlpPayload(
  database: DatabaseHandle,
  traces: PhoenixTraceWithSpans[],
  context: PhoenixImportContext,
) {
  const body = JSON.stringify(combineTracePayloads(traces, context));
  return ingestTelemetry(
    database.sqlite,
    {
      body,
      contentEncoding: "phoenix-import",
      searchMode: "compact",
      sizeBytes: Buffer.byteLength(body),
    },
  );
}

function combineTracePayloads(
  traces: PhoenixTraceWithSpans[],
  context: PhoenixImportContext,
): OtlpExportTraceServiceRequest {
  return {
    resourceSpans: traces.flatMap(
      (trace) => phoenixTraceToOtlp(trace, context).resourceSpans ?? [],
    ),
  };
}

async function updateCountersProgress(
  input: Pick<ImportPipelineInput, "counters" | "database" | "job" | "live">,
  patch: Parameters<typeof updatePhoenixImportJob>[2] = {},
) {
  await updateProgress({
    database: input.database,
    job: input.job,
    live: input.live,
    patch: {
      failedTraces: input.counters.failedTraces,
      importedObservations: input.counters.importedObservations,
      importedTraces: input.counters.importedTraces,
      totalObservations: input.counters.totalObservations,
      totalTraces: input.counters.totalTraces,
      ...patch,
    },
  });
}

async function updateProgress(input: {
  database: DatabaseHandle;
  job: Job<ImportJobData>;
  live: LiveEventStore;
  patch: Parameters<typeof updatePhoenixImportJob>[2];
}) {
  await renewJobLock(input.job);
  const updated = updatePhoenixImportJob(
    input.database.sqlite,
    input.job.data.appJobId,
    input.patch,
  );
  if (input.patch.progress != null) {
    await input.job.updateProgress(
      input.patch.progress,
      updated.currentTraceName ?? updated.status,
    );
  }
  publishPhoenixImportJob(input.live, updated);
}

async function renewJobLock(job: Job<ImportJobData>) {
  const lockableJob = job as Job<ImportJobData> & { token?: string };
  if (!lockableJob.token) return;
  await job.extendLock(lockableJob.token, 10 * 60 * 1000).catch(() => {});
}

async function markCancelled(input: {
  database: DatabaseHandle;
  job: Job<ImportJobData>;
  live: LiveEventStore;
}) {
  const updated = updatePhoenixImportJob(
    input.database.sqlite,
    input.job.data.appJobId,
    {
      errorMessage: "Import cancelled by user.",
      finishedAt: Date.now(),
      status: "cancelled",
    },
  );
  await input.job.updateProgress(updated.progress, "Import cancelled");
  publishPhoenixImportJob(input.live, updated);
}

function isCancelled(
  database: DatabaseHandle,
  appJobId: string,
  signal: AbortSignal | undefined,
) {
  return signal?.aborted || isPhoenixImportCancelled(database.sqlite, appJobId);
}

function assertNotCancelled(
  database: DatabaseHandle,
  appJobId: string,
  signal: AbortSignal | undefined,
) {
  if (isCancelled(database, appJobId, signal)) {
    throw new ImportCancelledError();
  }
}

function progressFor(processedTraces: number, totalTraces: number) {
  if (totalTraces <= 0) return processedTraces > 0 ? 95 : 5;
  return Math.min(99, Math.max(5, Math.floor((processedTraces / totalTraces) * 100)));
}

function isTransientImportError(error: Error) {
  if (error instanceof PhoenixApiError) {
    return error.status === 429 || (error.status != null && error.status >= 500);
  }
  return true;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function queueDataPath(databasePath: string) {
  return databasePath === ":memory:"
    ? ":memory:"
    : `${databasePath}.phoenix.bunqueue.sqlite`;
}
