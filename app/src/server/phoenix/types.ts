export type PhoenixImportStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type PhoenixTraceFilters = {
  fromTimestamp?: string;
  toTimestamp?: string;
  projectId?: string;
  projectName?: string;
};

/** Live counts shown on the import dialog's select step. */
export type PhoenixImportPreview = {
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  observations: number;
  observationsEstimated: boolean;
  sampleSize: number;
  sessions: number;
  sessionsEstimated: boolean;
  traces: number;
};

export type PhoenixProjectFacet = {
  id: string;
  name: string;
  traceCount: number | null;
};

export type PhoenixDiscovery = {
  baseUrl: string;
  projects: PhoenixProjectFacet[];
  traces: {
    totalItems: number;
  };
};

export type PhoenixConnection = {
  id: string;
  baseUrl: string;
  createdAt: string;
  discoveredProjects: PhoenixProjectFacet[];
  lastConnectedAt: string | null;
  lastError: string | null;
  lastStatus: string;
  name: string;
  updatedAt: string;
};

export type StoredPhoenixConnection = PhoenixConnection & {
  apiKey: string;
};

export type PhoenixImportJob = {
  id: string;
  bunqueueJobId: string | null;
  connectionId: string;
  connectionName: string | null;
  currentTraceId: string | null;
  currentTraceName: string | null;
  errorMessage: string | null;
  failedTraces: number;
  filters: PhoenixTraceFilters;
  finishedAt: string | null;
  importedObservations: number;
  importedTraces: number;
  progress: number;
  startedAt: string | null;
  status: PhoenixImportStatus;
  totalObservations: number;
  totalTraces: number;
  createdAt: string;
  updatedAt: string;
};

export type PhoenixProject = {
  id: string;
  name: string;
  description?: string | null;
};

export type PhoenixTraceListItem = {
  id: string;
  trace_id: string;
  project_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  token_count_prompt?: number | null;
  token_count_completion?: number | null;
  token_count_total?: number | null;
};

export type PhoenixSpanEvent = {
  name?: string | null;
  timestamp?: string | null;
  attributes?: Record<string, unknown> | null;
};

export type PhoenixSpan = {
  id: string;
  name?: string | null;
  context?: {
    trace_id?: string | null;
    span_id?: string | null;
  } | null;
  span_kind?: string | null;
  parent_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  status_code?: string | null;
  status_message?: string | null;
  attributes?: Record<string, unknown> | null;
  events?: PhoenixSpanEvent[] | null;
};

export type PhoenixTraceWithSpans = PhoenixTraceListItem & {
  spans: PhoenixSpan[];
};

export type PhoenixProjectListResponse = {
  data?: PhoenixProject[];
  next_cursor?: string | null;
};

export type PhoenixTraceListResponse = {
  data?: PhoenixTraceListItem[];
  next_cursor?: string | null;
};

export type PhoenixSpanListResponse = {
  data?: PhoenixSpan[];
  next_cursor?: string | null;
};
