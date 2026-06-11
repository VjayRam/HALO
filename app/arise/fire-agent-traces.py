# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "opentelemetry-sdk",
#   "opentelemetry-exporter-otlp-proto-http",
# ]
# ///
"""Fire synthetic AI-agent traces at the local Phoenix instance.

Emulates an agent loop: an AGENT root span containing a planning LLM call,
1-4 reasoning steps (LLM decide -> TOOL/RETRIEVER execute), and a final
synthesis LLM call. Spans follow OpenInference semantic conventions so
Phoenix renders them natively (token counts, messages, documents, sessions).

Usage: uv run fire-agent-traces.py [--traces 100] [--project halo-agent-sim]
                                   [--endpoint http://localhost:6006/v1/traces]
"""

from __future__ import annotations

import argparse
import json
import random
import time
import uuid

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode

NS = 1_000_000_000

MODELS = [
    ("claude-fable-5", 0.4),
    ("claude-sonnet-4-6", 0.3),
    ("claude-haiku-4-5", 0.2),
    ("gpt-5.2", 0.1),
]

USER_QUERIES = [
    "Summarize the Q2 churn numbers and flag any accounts at risk.",
    "Why did the nightly ETL job fail last night?",
    "Draft a follow-up email to the Kuzco team about the API migration.",
    "What were our top 5 slowest endpoints this week?",
    "Compare our pricing page conversion before and after the redesign.",
    "Find all open PRs older than two weeks and summarize their status.",
    "How many users hit the rate limiter yesterday, broken down by plan?",
    "Investigate the spike in 500s on the ingest service around 3am.",
    "Pull the latest NPS comments and cluster them by theme.",
    "What's the diff between staging and prod configs for the worker?",
    "Generate a runbook for rotating the Postgres credentials.",
    "Which customers are closest to their storage quota?",
    "Audit our OTLP ingest path for spans with missing parent ids.",
    "Write a release note for engine v0.1.19 from the merged PRs.",
    "Estimate token spend by model for the last 7 days.",
    "Check if the trace import queue is keeping up with backlog.",
    "List flaky tests in CI from the last 50 runs.",
    "Who are the top 10 most active workspace users this month?",
    "Translate the onboarding doc changes into a changelog entry.",
    "Validate that all halo run reports have a phase timeline.",
]

TOOLS = [
    {
        "name": "web_search",
        "description": "Search the web and return top results.",
        "args": lambda q: {"query": q[:60], "top_k": 5},
        "output": lambda: {"results": [f"https://example.com/doc/{uuid.uuid4().hex[:8]}" for _ in range(3)]},
    },
    {
        "name": "query_database",
        "description": "Run a read-only SQL query against the analytics warehouse.",
        "args": lambda q: {"sql": "SELECT day, count(*) FROM events WHERE day > now() - interval '7 days' GROUP BY 1"},
        "output": lambda: {"rows": random.randint(3, 240), "elapsed_ms": random.randint(40, 900)},
    },
    {
        "name": "run_python",
        "description": "Execute a Python snippet in a sandbox.",
        "args": lambda q: {"code": "df.groupby('plan').size().sort_values()"},
        "output": lambda: {"stdout": "free 1240\npro 311\nenterprise 42", "exit_code": 0},
    },
    {
        "name": "read_file",
        "description": "Read a file from the workspace.",
        "args": lambda q: {"path": f"src/server/{random.choice(['app.ts', 'router.ts', 'halo/runQueue.ts', 'telemetry/storage.ts'])}"},
        "output": lambda: {"bytes": random.randint(800, 42_000)},
    },
    {
        "name": "send_slack_message",
        "description": "Post a message to a Slack channel.",
        "args": lambda q: {"channel": "#eng-alerts", "text": "Investigation summary attached."},
        "output": lambda: {"ok": True, "ts": f"{time.time():.6f}"},
    },
]

RETRIEVER_DOCS = [
    "Runbook: ETL failures are usually caused by stale warehouse credentials. Rotate via vault and re-run the dag.",
    "Postmortem 2026-04: ingest 500 spike traced to clickhouse merge backlog; mitigation is to raise async_insert_busy_timeout.",
    "Pricing experiment notes: redesign lifted trial-to-paid conversion 14% but increased support tickets.",
    "API migration guide: v2 endpoints require the workspace header; legacy keys expire June 30.",
    "Oncall notes: rate limiter counters reset hourly; plan-level overrides live in settings.json.",
]

ERROR_MESSAGES = [
    "TimeoutError: tool call exceeded 30s deadline",
    "PermissionError: missing scope analytics:read",
    "ConnectionError: warehouse pool exhausted",
]


def pick_model() -> str:
    r, acc = random.random(), 0.0
    for model, w in MODELS:
        acc += w
        if r < acc:
            return model
    return MODELS[0][0]


def llm_attrs(model: str, system: str, user_msg: str, assistant_msg: str) -> dict:
    prompt_tokens = random.randint(220, 3200)
    completion_tokens = random.randint(40, 750)
    return {
        "openinference.span.kind": "LLM",
        "llm.model_name": model,
        "llm.provider": "anthropic" if model.startswith("claude") else "openai",
        "llm.invocation_parameters": json.dumps({"temperature": 0.2, "max_tokens": 4096}),
        "llm.input_messages.0.message.role": "system",
        "llm.input_messages.0.message.content": system,
        "llm.input_messages.1.message.role": "user",
        "llm.input_messages.1.message.content": user_msg,
        "llm.output_messages.0.message.role": "assistant",
        "llm.output_messages.0.message.content": assistant_msg,
        "llm.token_count.prompt": prompt_tokens,
        "llm.token_count.completion": completion_tokens,
        "llm.token_count.total": prompt_tokens + completion_tokens,
        "input.value": user_msg,
        "output.value": assistant_msg,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--traces", type=int, default=100)
    parser.add_argument("--project", default="halo-agent-sim")
    parser.add_argument("--endpoint", default="http://localhost:6006/v1/traces")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    resource = Resource.create(
        {
            "service.name": "halo-agent-sim",
            "openinference.project.name": args.project,
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=args.endpoint), max_export_batch_size=512)
    )
    tracer = provider.get_tracer("halo.agent.sim")

    users = [f"user_{i:02d}@halo.test" for i in range(10)]
    sessions = [uuid.uuid4().hex[:12] for _ in range(25)]

    now = time.time()
    span_total = 0
    error_total = 0

    # Spread trace start times over the last 6 hours, oldest first.
    starts = sorted(now - random.uniform(0, 6 * 3600) for _ in range(args.traces))

    for i, trace_start in enumerate(starts):
        query = random.choice(USER_QUERIES)
        session_id = random.choice(sessions)
        user_id = random.choice(users)
        model = pick_model()
        failed = random.random() < 0.08
        n_steps = random.randint(1, 4)

        t = trace_start
        root = tracer.start_span(
            "agent.run",
            start_time=int(t * NS),
            attributes={
                "openinference.span.kind": "AGENT",
                "input.value": query,
                "input.mime_type": "text/plain",
                "session.id": session_id,
                "user.id": user_id,
                "metadata": json.dumps({"agent_version": "0.4.2", "channel": "desktop"}),
                "tag.tags": ["simulation", "halo"],
            },
        )
        root_ctx = trace.set_span_in_context(root)
        span_total += 1

        # Planning LLM call
        t += random.uniform(0.05, 0.3)
        plan = tracer.start_span("llm.plan", context=root_ctx, start_time=int(t * NS))
        plan_secs = random.uniform(0.8, 3.5)
        plan.set_attributes(
            llm_attrs(
                model,
                "You are HALO, an autonomous operations agent. Plan tool use before answering.",
                query,
                f"Plan: break the task into {n_steps} step(s), gather data with tools, then synthesize.",
            )
        )
        plan.set_status(Status(StatusCode.OK))
        t += plan_secs
        plan.end(end_time=int(t * NS))
        span_total += 1

        step_failed = False
        for step in range(n_steps):
            step_span = tracer.start_span(
                f"agent.step_{step + 1}",
                context=root_ctx,
                start_time=int(t * NS),
                attributes={
                    "openinference.span.kind": "CHAIN",
                    "input.value": f"Step {step + 1} of {n_steps}: gather evidence for '{query[:48]}...'",
                },
            )
            step_ctx = trace.set_span_in_context(step_span)
            span_total += 1

            # LLM decides which tool to call
            tool = random.choice(TOOLS)
            t += random.uniform(0.05, 0.2)
            decide = tracer.start_span("llm.decide_action", context=step_ctx, start_time=int(t * NS))
            decide_secs = random.uniform(0.5, 2.0)
            tool_args = tool["args"](query)
            decide.set_attributes(
                llm_attrs(
                    model,
                    "Choose the next tool call. Respond with a tool invocation.",
                    f"Evidence so far is incomplete for: {query}",
                    f"Calling {tool['name']} with {json.dumps(tool_args)}",
                )
            )
            decide.set_attribute("llm.output_messages.0.message.tool_calls.0.tool_call.function.name", tool["name"])
            decide.set_attribute(
                "llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments", json.dumps(tool_args)
            )
            decide.set_status(Status(StatusCode.OK))
            t += decide_secs
            decide.end(end_time=int(t * NS))
            span_total += 1

            # Sometimes a retrieval instead of / alongside a tool call
            if random.random() < 0.35:
                t += random.uniform(0.02, 0.1)
                retr = tracer.start_span("retriever.knowledge_base", context=step_ctx, start_time=int(t * NS))
                docs = random.sample(RETRIEVER_DOCS, k=2)
                retr_attrs = {
                    "openinference.span.kind": "RETRIEVER",
                    "input.value": query,
                }
                for d_i, doc in enumerate(docs):
                    retr_attrs[f"retrieval.documents.{d_i}.document.id"] = f"doc_{uuid.uuid4().hex[:8]}"
                    retr_attrs[f"retrieval.documents.{d_i}.document.content"] = doc
                    retr_attrs[f"retrieval.documents.{d_i}.document.score"] = round(random.uniform(0.55, 0.97), 3)
                retr.set_attributes(retr_attrs)
                retr.set_status(Status(StatusCode.OK))
                t += random.uniform(0.1, 0.6)
                retr.end(end_time=int(t * NS))
                span_total += 1

            # Tool execution
            t += random.uniform(0.02, 0.1)
            tool_span = tracer.start_span(
                f"tool.{tool['name']}",
                context=step_ctx,
                start_time=int(t * NS),
                attributes={
                    "openinference.span.kind": "TOOL",
                    "tool.name": tool["name"],
                    "tool.description": tool["description"],
                    "tool.parameters": json.dumps(tool_args),
                    "input.value": json.dumps(tool_args),
                    "input.mime_type": "application/json",
                },
            )
            tool_secs = random.uniform(0.2, 4.0)
            this_fails = failed and step == n_steps - 1
            if this_fails:
                msg = random.choice(ERROR_MESSAGES)
                tool_span.add_event(
                    "exception",
                    {
                        "exception.type": msg.split(":")[0],
                        "exception.message": msg,
                        "exception.stacktrace": f'Traceback (most recent call last):\n  File "agent/tools.py", line {random.randint(40, 220)}, in invoke\n{msg}',
                    },
                )
                tool_span.set_status(Status(StatusCode.ERROR, msg))
                step_failed = True
            else:
                tool_span.set_attribute("output.value", json.dumps(tool["output"]()))
                tool_span.set_attribute("output.mime_type", "application/json")
                tool_span.set_status(Status(StatusCode.OK))
            t += tool_secs
            tool_span.end(end_time=int(t * NS))
            span_total += 1

            step_span.set_attribute(
                "output.value",
                "step failed" if this_fails else f"collected evidence via {tool['name']}",
            )
            step_span.set_status(Status(StatusCode.ERROR if this_fails else StatusCode.OK))
            t += random.uniform(0.01, 0.05)
            step_span.end(end_time=int(t * NS))
            if step_failed:
                break

        if step_failed:
            error_total += 1
            root.set_attribute("output.value", "Agent run aborted: tool execution failed.")
            root.set_status(Status(StatusCode.ERROR, "tool execution failed"))
        else:
            # Final synthesis LLM call
            t += random.uniform(0.05, 0.2)
            synth = tracer.start_span("llm.synthesize", context=root_ctx, start_time=int(t * NS))
            answer = f"Here is what I found for '{query[:60]}': evidence gathered across {n_steps} step(s); details and recommended next actions included."
            synth.set_attributes(
                llm_attrs(
                    model,
                    "Synthesize a final answer from the gathered evidence.",
                    f"Evidence complete. Answer the original question: {query}",
                    answer,
                )
            )
            synth.set_status(Status(StatusCode.OK))
            t += random.uniform(1.0, 4.0)
            synth.end(end_time=int(t * NS))
            span_total += 1

            root.set_attribute("output.value", answer)
            root.set_attribute("output.mime_type", "text/plain")
            root.set_status(Status(StatusCode.OK))

        root.end(end_time=int((t + random.uniform(0.01, 0.1)) * NS))

        if (i + 1) % 20 == 0:
            print(f"  built {i + 1}/{args.traces} traces...")

    provider.force_flush()
    provider.shutdown()
    print(
        f"sent {args.traces} traces / {span_total} spans "
        f"({error_total} failed runs) to {args.endpoint} (project: {args.project})"
    )


if __name__ == "__main__":
    main()
