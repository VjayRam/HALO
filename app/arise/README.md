# Local Arize Phoenix

This folder contains a local-only, self-hosted [Arize Phoenix](https://github.com/Arize-ai/phoenix) Docker Compose setup for Halo Canvas, mirroring the sibling `langfuse/` setup. It runs the Phoenix server backed by PostgreSQL.

## Start

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
docker compose up -d
docker compose ps
```

Phoenix is available at:

```text
http://localhost:6006
```

No login is required — authentication is disabled for this local setup (Phoenix's default). To enable it, set `PHOENIX_ENABLE_AUTH=true` and `PHOENIX_SECRET=<random string>` on the `phoenix` service, then log in with `admin@localhost` / `admin`.

## Endpoints

```text
UI / REST API:        http://localhost:6006
OTLP HTTP collector:  http://localhost:6006/v1/traces  (protobuf only, not JSON)
OTLP gRPC collector:  localhost:6007  (host port 6007 -> container 4317; 4317 is taken locally)
Postgres:             localhost:5433  (phoenix/phoenix/phoenix; 5432 is used by Langfuse)
```

No API key is needed for ingestion while auth is disabled.

## Smoke Test

Fires one OpenInference LLM span at the local instance and creates/updates the `halo-smoke-test` project:

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
uv run fire-test-span.py
curl -fsS http://localhost:6006/v1/projects
```

## Simulate Agent Traffic

Fires synthetic AI-agent traces (AGENT root span -> planning LLM -> tool/retriever steps -> synthesis LLM, with token counts, sessions, and ~8% failed runs) into the `halo-agent-sim` project, spread over the last 6 hours:

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
uv run fire-agent-traces.py --traces 100
```

Options: `--traces N`, `--project NAME`, `--endpoint URL`, `--seed N` (reproducible runs).

## Health Checks

```bash
curl -fsS http://localhost:6006/healthz
docker compose ps
```

## Stop

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
docker compose down
```

## Reset Local Data

Removes containers and the local Docker volumes (Postgres data and Phoenix working dir):

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
docker compose down -v
```

## Upgrade

```bash
cd /Users/samheutmaker/Desktop/context-labs/src/HALO/app/arise
docker compose up -d --pull always
```

## Notes

- Image is `arizephoenix/phoenix:latest` with `PHOENIX_SQL_DATABASE_URL` pointing at the bundled Postgres 16 container.
- The Compose project name is `halo-canvas-phoenix`, so containers and volumes stay separate from other local installs.
- All ports bind to `127.0.0.1` only.
- Projects are created implicitly on ingest via the `openinference.project.name` resource attribute (or default to the `default` project).
- Phoenix's OTLP HTTP endpoint accepts protobuf only; JSON payloads get a 415. Use an OTel SDK exporter (like the smoke-test script) or gRPC.
