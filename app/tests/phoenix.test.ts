import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  buildProjectListPath,
  buildSpanListPath,
  buildTraceListPath,
  discoverPhoenix,
  normalizePhoenixBaseUrl,
  previewPhoenixImport,
} from "../src/server/phoenix/client";
import { createPhoenixImportService } from "../src/server/phoenix/importQueue";
import {
  phoenixTraceToOtlp,
  toOtelSpanId,
} from "../src/server/phoenix/mapper";
import {
  getPhoenixImportJob,
  savePhoenixConnection,
} from "../src/server/phoenix/storage";
import { createDatabase, ensureSchema } from "../src/server/db/client";
import { createLiveEventStore } from "../src/server/live/events";
import { getSpansForTrace, getTrace } from "../src/server/telemetry/storage";

const API_KEY = "phx_test_key";
const TRACE_ID = "fedcba9876543210fedcba9876543210";
const PROJECT_GLOBAL_ID = "UHJvamVjdDox";

let servers: Bun.Server<undefined>[] = [];

afterEach(() => {
  for (const server of servers) server.stop(true);
  servers = [];
});

describe("Phoenix API helpers", () => {
  test("normalizes hosts", () => {
    expect(normalizePhoenixBaseUrl(" http://localhost:6006/ ")).toBe(
      "http://localhost:6006",
    );
    expect(normalizePhoenixBaseUrl("https://phoenix.example.com/path/")).toBe(
      "https://phoenix.example.com/path",
    );
  });

  test("builds project, trace, and span list paths", () => {
    expect(buildProjectListPath({ limit: 50 })).toBe("/v1/projects?limit=50");

    const tracePath = buildTraceListPath({
      filters: {
        fromTimestamp: "2026-05-01T00:00:00.000Z",
        toTimestamp: "2026-05-31T00:00:00.000Z",
      },
      limit: 25,
      order: "asc",
      projectIdentifier: PROJECT_GLOBAL_ID,
    });
    const traceUrl = new URL(tracePath, "http://phoenix.test");
    expect(traceUrl.pathname).toBe(`/v1/projects/${PROJECT_GLOBAL_ID}/traces`);
    expect(traceUrl.searchParams.get("limit")).toBe("25");
    expect(traceUrl.searchParams.get("sort")).toBe("start_time");
    expect(traceUrl.searchParams.get("order")).toBe("asc");
    expect(traceUrl.searchParams.get("start_time")).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(traceUrl.searchParams.get("end_time")).toBe(
      "2026-05-31T00:00:00.000Z",
    );

    const spanPath = buildSpanListPath({
      limit: 1000,
      projectIdentifier: PROJECT_GLOBAL_ID,
      traceIds: ["trace-a", "trace-b"],
    });
    const spanUrl = new URL(spanPath, "http://phoenix.test");
    expect(spanUrl.pathname).toBe(`/v1/projects/${PROJECT_GLOBAL_ID}/spans`);
    expect(spanUrl.searchParams.get("limit")).toBe("1000");
    expect(spanUrl.searchParams.getAll("trace_id")).toEqual([
      "trace-a",
      "trace-b",
    ]);
  });

  test("discovers projects with trace counts", async () => {
    const phoenix = startFakePhoenix();
    const discovery = await discoverPhoenix({
      apiKey: API_KEY,
      baseUrl: phoenix.baseUrl,
    });
    expect(discovery.projects).toHaveLength(1);
    expect(discovery.projects[0]?.name).toBe("halo-agent-sim");
    expect(discovery.projects[0]?.traceCount).toBe(1);
    expect(discovery.traces.totalItems).toBe(1);
  });

  test("previews import counts via GraphQL", async () => {
    const phoenix = startFakePhoenix();
    const preview = await previewPhoenixImport({
      apiKey: API_KEY,
      baseUrl: phoenix.baseUrl,
      filters: {
        fromTimestamp: "2026-05-01T00:00:00.000Z",
        projectId: PROJECT_GLOBAL_ID,
        projectName: "halo-agent-sim",
      },
    });
    expect(preview.traces).toBe(1);
    expect(preview.observations).toBe(3);
    expect(preview.observationsEstimated).toBe(false);
    expect(preview.sessions).toBe(1);
    expect(preview.earliestTimestamp).toBe("2026-05-22T10:00:00.000Z");
  });
});

describe("Phoenix mapping", () => {
  test("maps Phoenix spans into OTLP spans with provenance attributes", () => {
    const otlp = phoenixTraceToOtlp(makePhoenixTrace(), {
      baseUrl: "http://localhost:6006",
      connectionId: "connection-1",
      connectionName: "Local Phoenix",
      importedAt: "2026-06-11T00:00:00.000Z",
      importJobId: "job-1",
      projectId: PROJECT_GLOBAL_ID,
      projectName: "halo-agent-sim",
    });
    const resourceAttrs = otlp.resourceSpans?.[0]?.resource?.attributes ?? [];
    const spans = otlp.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];

    expect(
      resourceAttrs.some(
        (attribute) =>
          attribute.key === "service.name" &&
          attribute.value?.stringValue === "halo-agent-sim",
      ),
    ).toBe(true);
    expect(spans).toHaveLength(3);
    expect(spans[0]?.name).toBe("agent.run");
    expect(spans[0]?.spanId).toBe("aaaaaaaaaaaaaaaa");
    expect(spans[0]?.parentSpanId).toBeUndefined();
    expect(spans[1]?.parentSpanId).toBe("aaaaaaaaaaaaaaaa");
    expect(spans[1]?.kind).toBe("SPAN_KIND_CLIENT");
    expect(
      spans[1]?.attributes?.some(
        (attribute) =>
          attribute.key === "llm.model_name" &&
          attribute.value?.stringValue === "claude-sonnet-4-6",
      ),
    ).toBe(true);
    expect(
      spans[1]?.attributes?.some(
        (attribute) =>
          attribute.key === "openinference.span.kind" &&
          attribute.value?.stringValue === "LLM",
      ),
    ).toBe(true);
    expect(
      spans[2]?.attributes?.some(
        (attribute) =>
          attribute.key === "tool.name" &&
          attribute.value?.stringValue === "query_database",
      ),
    ).toBe(true);
    expect(spans[2]?.status?.code).toBe("STATUS_CODE_ERROR");
    expect(spans[2]?.events?.[0]?.name).toBe("exception");
    for (const span of spans) {
      expect(
        span.attributes?.some(
          (attribute) =>
            attribute.key === "halo.source" &&
            attribute.value?.stringValue === "phoenix",
        ),
      ).toBe(true);
      expect(
        span.attributes?.some(
          (attribute) =>
            attribute.key === "halo.source.trace_id" &&
            attribute.value?.stringValue === TRACE_ID,
        ),
      ).toBe(true);
    }
    expect(
      spans[0]?.attributes?.some(
        (attribute) =>
          attribute.key === "halo.source.url" &&
          attribute.value?.stringValue ===
            `http://localhost:6006/projects/${PROJECT_GLOBAL_ID}/traces/${TRACE_ID}`,
      ),
    ).toBe(true);
  });

  test("creates a fallback root only when a Phoenix trace has no spans", () => {
    const trace = { ...makePhoenixTrace(), spans: [] };
    const otlp = phoenixTraceToOtlp(trace, { projectName: "halo-agent-sim" });
    const spans = otlp.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];

    expect(spans).toHaveLength(1);
    expect(spans[0]?.spanId).toBe(toOtelSpanId(`halo-root:${TRACE_ID}`));
    expect(spans[0]?.name).toBe("Phoenix trace");
  });

  test("drops parent references that point outside the payload", () => {
    const trace = makePhoenixTrace();
    const orphan = trace.spans[1]!;
    const otlp = phoenixTraceToOtlp({ ...trace, spans: [orphan] });
    const spans = otlp.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
    expect(spans).toHaveLength(1);
    expect(spans[0]?.parentSpanId).toBeUndefined();
  });
});

describe("Phoenix import queue", () => {
  test("imports Phoenix traces end to end", async () => {
    const phoenix = startFakePhoenix();
    const database = createDatabase(":memory:");
    ensureSchema(database.sqlite);
    const live = createLiveEventStore(database.sqlite);
    const service = createPhoenixImportService({ database, live });

    try {
      const discovery = await discoverPhoenix({
        apiKey: API_KEY,
        baseUrl: phoenix.baseUrl,
      });
      const connection = savePhoenixConnection(database.sqlite, {
        apiKey: API_KEY,
        baseUrl: discovery.baseUrl,
        discovery,
        name: "Fake Phoenix",
      });

      const job = await service.start({
        connectionId: connection.id,
        filters: {
          fromTimestamp: "2026-05-01T00:00:00.000Z",
          projectId: PROJECT_GLOBAL_ID,
          projectName: "halo-agent-sim",
        },
      });
      const completed = await waitForImportJob(database.sqlite, job.id, "completed");

      expect(completed.importedTraces).toBe(1);
      expect(completed.importedObservations).toBe(3);
      expect(completed.totalTraces).toBe(1);
      expect(phoenix.state.spanListCalls).toBe(1);

      const trace = getTrace(database.sqlite, TRACE_ID);
      expect(trace?.rootSpanName).toBe("agent.run");
      expect(trace?.serviceName).toBe("halo-agent-sim");
      expect(trace?.llmSpanCount).toBe(1);
      expect(trace?.hasError).toBe(true);
      expect(trace?.source).toBe("phoenix");
      expect(trace?.sourceConnectionName).toBe("Fake Phoenix");
      expect(trace?.sourceTraceId).toBe(TRACE_ID);
      expect(trace?.sessionId).toBe("session-42");

      const spans = getSpansForTrace(database.sqlite, { traceId: TRACE_ID });
      expect(spans.spans).toHaveLength(3);
      expect(
        spans.spans.some((span) => span.observationKind === "TOOL"),
      ).toBe(true);
      expect(
        spans.spans.some((span) => span.observationKind === "LLM"),
      ).toBe(true);
      const llmSpan = spans.spans.find((span) => span.observationKind === "LLM");
      expect(llmSpan?.llmModelName).toBe("claude-sonnet-4-6");
      expect(llmSpan?.totalTokens).toBe(30);
    } finally {
      await service.close(true);
      database.sqlite.close(false);
    }
  });

  test("rejects starting an import without a project", async () => {
    const phoenix = startFakePhoenix();
    const database = createDatabase(":memory:");
    ensureSchema(database.sqlite);
    const live = createLiveEventStore(database.sqlite);
    const service = createPhoenixImportService({ database, live });

    try {
      const discovery = await discoverPhoenix({
        apiKey: API_KEY,
        baseUrl: phoenix.baseUrl,
      });
      const connection = savePhoenixConnection(database.sqlite, {
        apiKey: API_KEY,
        baseUrl: discovery.baseUrl,
        discovery,
        name: "Fake Phoenix",
      });
      expect(
        service.start({ connectionId: connection.id, filters: {} }),
      ).rejects.toThrow("project");
    } finally {
      await service.close(true);
      database.sqlite.close(false);
    }
  });

  test("continues importing when GraphQL counts are unavailable", async () => {
    const phoenix = startFakePhoenix({ graphqlStatus: 404 });
    const database = createDatabase(":memory:");
    ensureSchema(database.sqlite);
    const live = createLiveEventStore(database.sqlite);
    const service = createPhoenixImportService({ database, live });

    try {
      const discovery = await discoverPhoenix({
        apiKey: API_KEY,
        baseUrl: phoenix.baseUrl,
      });
      const connection = savePhoenixConnection(database.sqlite, {
        apiKey: API_KEY,
        baseUrl: discovery.baseUrl,
        discovery,
        name: "Fake Phoenix",
      });

      const job = await service.start({
        connectionId: connection.id,
        filters: {
          projectId: PROJECT_GLOBAL_ID,
          projectName: "halo-agent-sim",
        },
      });
      const completed = await waitForImportJob(database.sqlite, job.id, "completed");
      expect(completed.importedTraces).toBe(1);
      expect(completed.importedObservations).toBe(3);
    } finally {
      await service.close(true);
      database.sqlite.close(false);
    }
  });
});

function startFakePhoenix(input: { graphqlStatus?: number } = {}) {
  const state = {
    spanListCalls: 0,
    traceListCalls: 0,
  };
  const app = new Hono();
  app.get("/healthz", (c) => c.text("OK"));
  app.use("/v1/*", async (c, next) => {
    if (c.req.header("authorization") !== `Bearer ${API_KEY}`) {
      return c.json({ message: "unauthorized" }, 401);
    }
    await next();
  });
  app.get("/v1/projects", (c) =>
    c.json({
      data: [
        {
          description: "Synthetic agent traces",
          id: PROJECT_GLOBAL_ID,
          name: "halo-agent-sim",
        },
      ],
      next_cursor: null,
    }),
  );
  app.get("/v1/projects/:projectId/traces", (c) => {
    state.traceListCalls += 1;
    return c.json({
      data: [makePhoenixTraceListItem()],
      next_cursor: null,
    });
  });
  app.get("/v1/projects/:projectId/spans", (c) => {
    state.spanListCalls += 1;
    const traceIds = c.req.queries("trace_id") ?? [];
    return c.json({
      data: makePhoenixTrace().spans.filter((span) =>
        traceIds.includes(span.context.trace_id),
      ),
      next_cursor: null,
    });
  });
  app.post("/graphql", async (c) => {
    if (input.graphqlStatus) {
      return new Response("unsupported", { status: input.graphqlStatus });
    }
    const body = (await c.req.json()) as { query?: string };
    if (body.query?.includes("sessions")) {
      return c.json({
        data: {
          node: {
            sessions: {
              edges: [{ cursor: "session-cursor-1" }],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      });
    }
    return c.json({
      data: { node: { recordCount: 3, traceCount: 1 } },
    });
  });

  const server = Bun.serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
  });
  servers.push(server);
  return { baseUrl: `http://127.0.0.1:${server.port}`, state };
}

async function waitForImportJob(
  sqlite: ReturnType<typeof createDatabase>["sqlite"],
  jobId: string,
  status: string,
) {
  const timeoutAt = Date.now() + 4_000;
  while (Date.now() < timeoutAt) {
    const job = getPhoenixImportJob(sqlite, jobId);
    if (job?.status === status) return job;
    if (job?.status === "failed") {
      throw new Error(job.errorMessage ?? "Import failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for import job ${jobId}`);
}

function makePhoenixTraceListItem() {
  return {
    end_time: "2026-05-22T10:00:03.000Z",
    id: "VHJhY2U6MQ==",
    project_id: PROJECT_GLOBAL_ID,
    start_time: "2026-05-22T10:00:00.000Z",
    token_count_completion: 20,
    token_count_prompt: 10,
    token_count_total: 30,
    trace_id: TRACE_ID,
  };
}

function makePhoenixTrace() {
  return {
    ...makePhoenixTraceListItem(),
    spans: [
      {
        attributes: {
          "input.value": "List contacts",
          "openinference.span.kind": "AGENT",
          "output.value": "Here are contacts",
          "session.id": "session-42",
          "user.id": "user-1",
        },
        context: { span_id: "aaaaaaaaaaaaaaaa", trace_id: TRACE_ID },
        end_time: "2026-05-22T10:00:03.000Z",
        events: [],
        id: "U3Bhbjox",
        name: "agent.run",
        parent_id: null,
        span_kind: "AGENT",
        start_time: "2026-05-22T10:00:00.000Z",
        status_code: "OK",
        status_message: "",
      },
      {
        attributes: {
          "input.value": "List contacts",
          "llm.input_messages.0.message.content": "List contacts",
          "llm.input_messages.0.message.role": "user",
          "llm.model_name": "claude-sonnet-4-6",
          "llm.output_messages.0.message.content": "Here are contacts",
          "llm.output_messages.0.message.role": "assistant",
          "llm.provider": "anthropic",
          "llm.token_count.completion": 20,
          "llm.token_count.prompt": 10,
          "llm.token_count.total": 30,
          "output.value": "Here are contacts",
          "session.id": "session-42",
          "user.id": "user-1",
        },
        context: { span_id: "1111111111111111", trace_id: TRACE_ID },
        end_time: "2026-05-22T10:00:02.000Z",
        events: [],
        id: "U3Bhbjoy",
        name: "llm.chat",
        parent_id: "aaaaaaaaaaaaaaaa",
        span_kind: "LLM",
        start_time: "2026-05-22T10:00:01.000Z",
        status_code: "OK",
        status_message: "",
      },
      {
        attributes: {
          "input.value": '{"limit":5}',
          "session.id": "session-42",
          "tool.name": "query_database",
          "user.id": "user-1",
        },
        context: { span_id: "2222222222222222", trace_id: TRACE_ID },
        end_time: "2026-05-22T10:00:03.000Z",
        events: [
          {
            attributes: {
              "exception.message": "TimeoutError: tool call exceeded deadline",
              "exception.type": "TimeoutError",
            },
            name: "exception",
            timestamp: "2026-05-22T10:00:02.900Z",
          },
        ],
        id: "U3Bhbjoz",
        name: "tool.query_database",
        parent_id: "aaaaaaaaaaaaaaaa",
        span_kind: "TOOL",
        start_time: "2026-05-22T10:00:02.100Z",
        status_code: "ERROR",
        status_message: "TimeoutError: tool call exceeded deadline",
      },
    ],
  };
}
