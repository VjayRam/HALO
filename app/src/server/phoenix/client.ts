import type {
  PhoenixDiscovery,
  PhoenixImportPreview,
  PhoenixProjectFacet,
  PhoenixProjectListResponse,
  PhoenixSpanListResponse,
  PhoenixTraceFilters,
  PhoenixTraceListResponse,
} from "./types";

export class PhoenixApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PhoenixApiError";
  }
}

type GraphqlResponse<T> = {
  data?: T | null;
  errors?: Array<{ message?: string }>;
};

export class PhoenixApiClient {
  readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(input: { baseUrl: string; apiKey?: string | null }) {
    this.baseUrl = normalizePhoenixBaseUrl(input.baseUrl);
    this.apiKey = (input.apiKey ?? "").trim();
  }

  async health(signal?: AbortSignal) {
    await this.fetchText("/healthz", { signal, timeoutMs: 10_000 });
    return { status: "ok" };
  }

  async listProjects(
    input: { cursor?: string | null; limit?: number } = {},
    signal?: AbortSignal,
  ) {
    return this.fetchJson<PhoenixProjectListResponse>(
      buildProjectListPath(input),
      { signal },
    );
  }

  async listTraces(
    input: {
      cursor?: string | null;
      filters?: PhoenixTraceFilters;
      limit?: number;
      order?: "asc" | "desc";
      projectIdentifier: string;
    },
    signal?: AbortSignal,
  ) {
    return this.fetchJson<PhoenixTraceListResponse>(buildTraceListPath(input), {
      signal,
    });
  }

  async listSpans(
    input: {
      cursor?: string | null;
      filters?: PhoenixTraceFilters;
      limit?: number;
      projectIdentifier: string;
      traceIds?: string[];
    },
    signal?: AbortSignal,
  ) {
    return this.fetchJson<PhoenixSpanListResponse>(buildSpanListPath(input), {
      signal,
    });
  }

  /**
   * Exact trace/span counts for a project over an optional time window via
   * GraphQL — the REST API is cursor-paged and has no totals. Returns nulls
   * when GraphQL is unavailable so callers can fall back to estimates.
   */
  async projectCounts(
    input: {
      projectId: string;
      fromTimestamp?: string;
      toTimestamp?: string;
    },
    signal?: AbortSignal,
  ): Promise<{ traceCount: number | null; spanCount: number | null }> {
    const timeRange = graphqlTimeRange(input.fromTimestamp, input.toTimestamp);
    try {
      const result = await this.graphql<{
        node?: { traceCount?: number; recordCount?: number } | null;
      }>(
        `query ($id: ID!${timeRange ? ", $timeRange: TimeRange" : ""}) {
          node(id: $id) {
            ... on Project {
              traceCount${timeRange ? "(timeRange: $timeRange)" : ""}
              recordCount${timeRange ? "(timeRange: $timeRange)" : ""}
            }
          }
        }`,
        timeRange ? { id: input.projectId, timeRange } : { id: input.projectId },
        signal,
      );
      return {
        spanCount: asCount(result.node?.recordCount),
        traceCount: asCount(result.node?.traceCount),
      };
    } catch {
      return { spanCount: null, traceCount: null };
    }
  }

  /**
   * Distinct session sample for a project over an optional time window. The
   * REST sessions endpoint has no time filter, so this uses GraphQL and
   * reports whether more pages exist beyond the sample.
   */
  async projectSessionSample(
    input: {
      projectId: string;
      fromTimestamp?: string;
      toTimestamp?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<{ sessions: number; hasMore: boolean } | null> {
    const timeRange = graphqlTimeRange(input.fromTimestamp, input.toTimestamp);
    try {
      const result = await this.graphql<{
        node?: {
          sessions?: {
            edges?: Array<unknown>;
            pageInfo?: { hasNextPage?: boolean };
          };
        } | null;
      }>(
        `query ($id: ID!, $first: Int${timeRange ? ", $timeRange: TimeRange" : ""}) {
          node(id: $id) {
            ... on Project {
              sessions(first: $first${timeRange ? ", timeRange: $timeRange" : ""}) {
                edges { cursor }
                pageInfo { hasNextPage }
              }
            }
          }
        }`,
        {
          first: input.limit ?? 100,
          id: input.projectId,
          ...(timeRange ? { timeRange } : {}),
        },
        signal,
      );
      const sessions = result.node?.sessions;
      if (!sessions) return null;
      return {
        hasMore: sessions.pageInfo?.hasNextPage ?? false,
        sessions: sessions.edges?.length ?? 0,
      };
    } catch {
      return null;
    }
  }

  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchJson<GraphqlResponse<T>>("/graphql", {
      body: JSON.stringify({ query, variables }),
      method: "POST",
      signal,
    });
    if (!response.data || response.errors?.length) {
      throw new PhoenixApiError(
        response.errors?.[0]?.message ?? "Phoenix GraphQL query failed",
      );
    }
    return response.data;
  }

  private async fetchJson<T>(
    path: string,
    options: {
      body?: string;
      method?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const text = await this.fetchText(path, options);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PhoenixApiError("Phoenix returned a non-JSON response");
    }
  }

  private async fetchText(
    path: string,
    options: {
      body?: string;
      method?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<string> {
    // Self-hosted Phoenix instances can take seconds per page on data-heavy
    // endpoints, and a multi-thousand-trace import makes hundreds of
    // requests — one slow response must not kill the whole run. Retry
    // timeouts and transient server errors with backoff before giving up.
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.fetchTextOnce(path, options);
      } catch (error) {
        const callerAborted = options.signal?.aborted ?? false;
        const retriable =
          error instanceof PhoenixApiError &&
          (error.status === undefined || // timeout / network failure
            error.status === 408 ||
            error.status === 429 ||
            error.status >= 500);
        if (callerAborted || !retriable || attempt >= maxAttempts) throw error;
        await Bun.sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)) * (0.5 + Math.random()));
      }
    }
  }

  private async fetchTextOnce(
    path: string,
    options: {
      body?: string;
      method?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<string> {
    const url = new URL(path, `${this.baseUrl}/`);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60_000,
    );
    const signal = mergeSignals(controller.signal, options.signal);

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (options.body) headers["content-type"] = "application/json";

    try {
      const response = await fetch(url, {
        body: options.body,
        headers,
        method: options.method ?? "GET",
        signal,
      });
      if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new PhoenixApiError(
          readablePhoenixError(response.status, message),
          response.status,
        );
      }
      return await response.text();
    } catch (error) {
      if (error instanceof PhoenixApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new PhoenixApiError("Timed out while connecting to Phoenix");
      }
      throw new PhoenixApiError(
        error instanceof Error ? error.message : "Could not connect to Phoenix",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

const DISCOVERY_PROJECT_PAGE_LIMIT = 100;
const DISCOVERY_PROJECT_PAGE_MAX = 10;

export async function discoverPhoenix(input: {
  baseUrl: string;
  apiKey?: string | null;
}): Promise<PhoenixDiscovery> {
  const client = new PhoenixApiClient(input);
  await client.health();

  const projects: PhoenixProjectFacet[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < DISCOVERY_PROJECT_PAGE_MAX; page += 1) {
    const response = await client.listProjects({
      cursor,
      limit: DISCOVERY_PROJECT_PAGE_LIMIT,
    });
    for (const project of response.data ?? []) {
      projects.push({ id: project.id, name: project.name, traceCount: null });
    }
    cursor = response.next_cursor ?? null;
    if (!cursor) break;
  }

  // Trace counts make the project picker far more useful; fetch them in
  // parallel but tolerate GraphQL being unavailable.
  await Promise.all(
    projects.map(async (project) => {
      const counts = await client.projectCounts({ projectId: project.id });
      project.traceCount = counts.traceCount;
    }),
  );

  return {
    baseUrl: client.baseUrl,
    projects,
    traces: {
      totalItems: projects.reduce(
        (sum, project) => sum + (project.traceCount ?? 0),
        0,
      ),
    },
  };
}

const PREVIEW_SESSION_SAMPLE_LIMIT = 100;

/**
 * Live counts for the import dialog's select step. Trace and span totals come
 * from GraphQL and are exact; when GraphQL is unavailable they fall back to a
 * one-page sample and are flagged as estimates. Sessions are sampled the same
 * way Langfuse previews are.
 */
export async function previewPhoenixImport(input: {
  baseUrl: string;
  apiKey?: string | null;
  filters?: PhoenixTraceFilters;
  signal?: AbortSignal;
}): Promise<PhoenixImportPreview> {
  const client = new PhoenixApiClient(input);
  const filters = compactPhoenixFilters(input.filters);
  const projectIdentifier = filters.projectId ?? filters.projectName;
  if (!projectIdentifier) {
    throw new PhoenixApiError("A Phoenix project is required");
  }

  const [latestPage, earliestPage, counts, sessionSample] = await Promise.all([
    client.listTraces(
      { filters, limit: 1, order: "desc", projectIdentifier },
      input.signal,
    ),
    client.listTraces(
      { filters, limit: 1, order: "asc", projectIdentifier },
      input.signal,
    ),
    filters.projectId
      ? client.projectCounts(
          {
            fromTimestamp: filters.fromTimestamp,
            projectId: filters.projectId,
            toTimestamp: filters.toTimestamp,
          },
          input.signal,
        )
      : Promise.resolve({ spanCount: null, traceCount: null }),
    filters.projectId
      ? client.projectSessionSample(
          {
            fromTimestamp: filters.fromTimestamp,
            limit: PREVIEW_SESSION_SAMPLE_LIMIT,
            projectId: filters.projectId,
            toTimestamp: filters.toTimestamp,
          },
          input.signal,
        )
      : Promise.resolve(null),
  ]);

  const latestTrace = latestPage.data?.[0] ?? null;
  let traces = counts.traceCount ?? 0;
  let tracesEstimated = false;
  if (counts.traceCount == null) {
    traces = latestTrace ? 1 : 0;
    tracesEstimated = Boolean(latestTrace);
  }

  return {
    earliestTimestamp: earliestPage.data?.[0]?.start_time ?? null,
    latestTimestamp: latestTrace?.start_time ?? null,
    observations: counts.spanCount ?? 0,
    observationsEstimated: counts.spanCount == null && traces > 0,
    sampleSize: sessionSample?.sessions ?? 0,
    sessions: sessionSample?.sessions ?? 0,
    sessionsEstimated: sessionSample?.hasMore ?? tracesEstimated,
    traces,
  };
}

export function normalizePhoenixBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new PhoenixApiError("Phoenix URL is required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new PhoenixApiError("Phoenix URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PhoenixApiError("Phoenix URL must start with http or https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function buildProjectListPath(input: {
  cursor?: string | null;
  limit?: number;
}) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 100));
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/projects?${params.toString()}`;
}

export function buildTraceListPath(input: {
  cursor?: string | null;
  filters?: PhoenixTraceFilters;
  limit?: number;
  order?: "asc" | "desc";
  projectIdentifier: string;
}) {
  const identifier = input.projectIdentifier.trim();
  if (!identifier) throw new PhoenixApiError("A Phoenix project is required");
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 100));
  params.set("sort", "start_time");
  params.set("order", input.order ?? "asc");
  const filters = compactPhoenixFilters(input.filters);
  if (filters.fromTimestamp) params.set("start_time", filters.fromTimestamp);
  if (filters.toTimestamp) params.set("end_time", filters.toTimestamp);
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/projects/${encodeURIComponent(identifier)}/traces?${params.toString()}`;
}

export function buildSpanListPath(input: {
  cursor?: string | null;
  filters?: PhoenixTraceFilters;
  limit?: number;
  projectIdentifier: string;
  traceIds?: string[];
}) {
  const identifier = input.projectIdentifier.trim();
  if (!identifier) throw new PhoenixApiError("A Phoenix project is required");
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 1000));
  for (const traceId of input.traceIds ?? []) {
    const trimmed = traceId.trim();
    if (trimmed) params.append("trace_id", trimmed);
  }
  if (input.cursor) params.set("cursor", input.cursor);
  return `/v1/projects/${encodeURIComponent(identifier)}/spans?${params.toString()}`;
}

export function compactPhoenixFilters(
  filters: PhoenixTraceFilters | undefined,
): PhoenixTraceFilters {
  if (!filters) return {};
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value != null && value !== ""),
  ) as PhoenixTraceFilters;
}

function graphqlTimeRange(fromTimestamp?: string, toTimestamp?: string) {
  if (!fromTimestamp && !toTimestamp) return null;
  return {
    ...(fromTimestamp ? { start: fromTimestamp } : {}),
    ...(toTimestamp ? { end: toTimestamp } : {}),
  };
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readablePhoenixError(status: number, body: string) {
  if (status === 401 || status === 403) {
    return "Phoenix rejected the supplied API key.";
  }
  if (status === 404) {
    return "Phoenix endpoint was not found. Check the URL and project.";
  }
  const trimmed = body.trim();
  return trimmed
    ? `Phoenix returned HTTP ${status}: ${trimmed.slice(0, 300)}`
    : `Phoenix returned HTTP ${status}`;
}

function mergeSignals(
  first: AbortSignal,
  second: AbortSignal | undefined,
): AbortSignal {
  if (!second) return first;
  if (first.aborted || second.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
