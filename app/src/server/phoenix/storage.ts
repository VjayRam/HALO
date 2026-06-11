import type { Database } from "bun:sqlite";
import type { ImportJobSnapshot, LiveEventStore } from "../live/events";
import type {
  PhoenixConnection,
  PhoenixDiscovery,
  PhoenixImportJob,
  PhoenixImportStatus,
  PhoenixTraceFilters,
  StoredPhoenixConnection,
} from "./types";

type ConnectionRow = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  discovered_projects_json: string;
  last_status: string;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
};

type JobRow = {
  id: string;
  connection_id: string;
  connection_name: string | null;
  bunqueue_job_id: string | null;
  status: PhoenixImportStatus;
  filters_json: string;
  progress: number;
  total_traces: number;
  imported_traces: number;
  total_observations: number;
  imported_observations: number;
  failed_traces: number;
  error_message: string | null;
  current_trace_id: string | null;
  current_trace_name: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
};

export function listPhoenixConnections(sqlite: Database): PhoenixConnection[] {
  return sqlite
    .query<ConnectionRow, []>(
      `SELECT *
       FROM phoenix_connections
       ORDER BY updated_at DESC`,
    )
    .all()
    .map((row) => mapConnection(row, false));
}

export function getPhoenixConnection(
  sqlite: Database,
  id: string,
): StoredPhoenixConnection | null {
  const row = sqlite
    .query<ConnectionRow, [string]>(
      `SELECT *
       FROM phoenix_connections
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id);
  return row ? mapConnection(row, true) : null;
}

export function savePhoenixConnection(
  sqlite: Database,
  input: {
    apiKey: string;
    baseUrl: string;
    discovery: PhoenixDiscovery;
    id?: string;
    name: string;
  },
): PhoenixConnection {
  const now = Date.now();
  const id =
    input.id ??
    findPhoenixConnectionIdByBaseUrl(sqlite, input.baseUrl) ??
    crypto.randomUUID();
  const existing = getPhoenixConnection(sqlite, id);

  sqlite
    .query(
      `INSERT INTO phoenix_connections (
        id, name, base_url, api_key, discovered_projects_json, last_status,
        last_error, last_connected_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'connected', NULL, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        api_key = excluded.api_key,
        discovered_projects_json = excluded.discovered_projects_json,
        last_status = excluded.last_status,
        last_error = excluded.last_error,
        last_connected_at = excluded.last_connected_at,
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.name,
      input.baseUrl,
      input.apiKey,
      JSON.stringify(input.discovery.projects),
      now,
      existing ? Date.parse(existing.createdAt) : now,
      now,
    );

  const saved = listPhoenixConnections(sqlite).find((row) => row.id === id);
  if (!saved) throw new Error("Failed to save Phoenix connection");
  return saved;
}

function findPhoenixConnectionIdByBaseUrl(
  sqlite: Database,
  baseUrl: string,
): string | null {
  return (
    sqlite
      .query<{ id: string }, [string]>(
        `SELECT id
         FROM phoenix_connections
         WHERE base_url = ?
         LIMIT 1`,
      )
      .get(baseUrl)?.id ?? null
  );
}

export function markPhoenixConnectionError(
  sqlite: Database,
  input: { id?: string; baseUrl?: string; error: string },
) {
  const now = Date.now();
  if (input.id) {
    sqlite
      .query(
        `UPDATE phoenix_connections
         SET last_status = 'error', last_error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.error, now, input.id);
    return;
  }
  if (input.baseUrl) {
    sqlite
      .query(
        `UPDATE phoenix_connections
         SET last_status = 'error', last_error = ?, updated_at = ?
         WHERE base_url = ?`,
      )
      .run(input.error, now, input.baseUrl);
  }
}

export function deletePhoenixConnection(sqlite: Database, id: string) {
  sqlite.query("DELETE FROM phoenix_connections WHERE id = ?").run(id);
}

export function createPhoenixImportJob(
  sqlite: Database,
  input: { connectionId: string; filters: PhoenixTraceFilters },
): PhoenixImportJob {
  const now = Date.now();
  const id = crypto.randomUUID();
  sqlite
    .query(
      `INSERT INTO phoenix_import_jobs (
        id, connection_id, status, filters_json, progress, created_at, updated_at
      ) VALUES (?, ?, 'queued', ?, 0, ?, ?)`,
    )
    .run(id, input.connectionId, JSON.stringify(input.filters), now, now);
  const job = getPhoenixImportJob(sqlite, id);
  if (!job) throw new Error("Failed to create Phoenix import job");
  return job;
}

export function updatePhoenixImportJob(
  sqlite: Database,
  id: string,
  patch: Partial<{
    bunqueueJobId: string | null;
    currentTraceId: string | null;
    currentTraceName: string | null;
    errorMessage: string | null;
    failedTraces: number;
    finishedAt: number | null;
    importedObservations: number;
    importedTraces: number;
    progress: number;
    startedAt: number | null;
    status: PhoenixImportStatus;
    totalObservations: number;
    totalTraces: number;
  }>,
): PhoenixImportJob {
  const sets: string[] = ["updated_at = :updatedAt"];
  const params: Record<string, string | number | null> = {
    id,
    updatedAt: Date.now(),
  };

  const add = (column: string, key: keyof typeof patch) => {
    if (!(key in patch)) return;
    sets.push(`${column} = :${String(key)}`);
    params[String(key)] = patch[key] ?? null;
  };

  add("bunqueue_job_id", "bunqueueJobId");
  add("status", "status");
  add("progress", "progress");
  add("total_traces", "totalTraces");
  add("imported_traces", "importedTraces");
  add("total_observations", "totalObservations");
  add("imported_observations", "importedObservations");
  add("failed_traces", "failedTraces");
  add("error_message", "errorMessage");
  add("current_trace_id", "currentTraceId");
  add("current_trace_name", "currentTraceName");
  add("started_at", "startedAt");
  add("finished_at", "finishedAt");

  sqlite
    .query(
      `UPDATE phoenix_import_jobs
       SET ${sets.join(", ")}
       WHERE id = :id`,
    )
    .run(params);

  const job = getPhoenixImportJob(sqlite, id);
  if (!job) throw new Error("Phoenix import job not found");
  return job;
}

export function getPhoenixImportJob(
  sqlite: Database,
  id: string,
): PhoenixImportJob | null {
  const row = sqlite
    .query<JobRow, [string]>(
      `SELECT
        j.*,
        c.name AS connection_name
       FROM phoenix_import_jobs j
       LEFT JOIN phoenix_connections c ON c.id = j.connection_id
       WHERE j.id = ?
       LIMIT 1`,
    )
    .get(id);
  return row ? mapImportJob(row) : null;
}

export function listPhoenixImportJobs(
  sqlite: Database,
  limit = 20,
): PhoenixImportJob[] {
  return sqlite
    .query<JobRow, [number]>(
      `SELECT
        j.*,
        c.name AS connection_name
       FROM phoenix_import_jobs j
       LEFT JOIN phoenix_connections c ON c.id = j.connection_id
       ORDER BY j.updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map(mapImportJob);
}

export function markInterruptedPhoenixImports(sqlite: Database) {
  const now = Date.now();
  sqlite
    .query(
      `UPDATE phoenix_import_jobs
       SET status = 'interrupted',
           error_message = 'The app stopped before this import finished.',
           finished_at = ?,
           updated_at = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(now, now);
}

export function isPhoenixImportCancelled(sqlite: Database, id: string) {
  const row = sqlite
    .query<{ status: string }, [string]>(
      `SELECT status
       FROM phoenix_import_jobs
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id);
  return row?.status === "cancelled";
}

export function publishPhoenixImportJob(
  live: LiveEventStore,
  job: PhoenixImportJob,
) {
  live.publish({
    eventType: "import.job.updated",
    payload: {
      job: importJobToSnapshot(job),
      type: "import.job.updated",
    },
  });
}

function importJobToSnapshot(job: PhoenixImportJob): ImportJobSnapshot {
  return {
    bunqueueJobId: job.bunqueueJobId,
    connectionId: job.connectionId,
    connectionName: job.connectionName,
    currentTraceId: job.currentTraceId,
    currentTraceName: job.currentTraceName,
    errorMessage: job.errorMessage,
    failedTraces: job.failedTraces,
    finishedAt: job.finishedAt,
    id: job.id,
    importedObservations: job.importedObservations,
    importedTraces: job.importedTraces,
    progress: job.progress,
    provider: "phoenix",
    startedAt: job.startedAt,
    status: job.status,
    totalObservations: job.totalObservations,
    totalTraces: job.totalTraces,
    updatedAt: job.updatedAt,
  };
}

function mapConnection<T extends boolean>(
  row: ConnectionRow,
  includeSecret: T,
): T extends true ? StoredPhoenixConnection : PhoenixConnection {
  const connection = {
    baseUrl: row.base_url,
    createdAt: isoFromMs(row.created_at),
    discoveredProjects: parseJson<PhoenixConnection["discoveredProjects"]>(
      row.discovered_projects_json,
      [],
    ),
    id: row.id,
    lastConnectedAt: row.last_connected_at ? isoFromMs(row.last_connected_at) : null,
    lastError: row.last_error,
    lastStatus: row.last_status,
    name: row.name,
    updatedAt: isoFromMs(row.updated_at),
  };
  return (
    includeSecret ? { ...connection, apiKey: row.api_key } : connection
  ) as T extends true ? StoredPhoenixConnection : PhoenixConnection;
}

function mapImportJob(row: JobRow): PhoenixImportJob {
  return {
    bunqueueJobId: row.bunqueue_job_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    createdAt: isoFromMs(row.created_at),
    currentTraceId: row.current_trace_id,
    currentTraceName: row.current_trace_name,
    errorMessage: row.error_message,
    failedTraces: row.failed_traces,
    filters: parseJson(row.filters_json, {}),
    finishedAt: row.finished_at ? isoFromMs(row.finished_at) : null,
    id: row.id,
    importedObservations: row.imported_observations,
    importedTraces: row.imported_traces,
    progress: row.progress,
    startedAt: row.started_at ? isoFromMs(row.started_at) : null,
    status: row.status,
    totalObservations: row.total_observations,
    totalTraces: row.total_traces,
    updatedAt: isoFromMs(row.updated_at),
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}
