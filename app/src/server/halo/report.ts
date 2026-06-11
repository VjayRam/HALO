import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import type { DatabaseHandle } from "../db/client";
import type { HaloRun, HaloRunTurn } from "./types";
import { getHaloRun, listHaloRunTurns } from "./storage";

export type HaloRunArtifact = {
  artifactType: string;
  createdAt: number;
  id: string;
  path: string;
  runId: string;
  sizeBytes: number;
};

export const REPORT_ARTIFACT_TYPE = "report_markdown";

export function outputDirForRun(databasePath: string, runId: string) {
  if (databasePath === ":memory:") return resolve("data/halo-runs", runId);
  return resolve(dirname(databasePath), "halo-runs", runId);
}

/**
 * Materialize the run's final answer as a markdown report on disk and record
 * it in halo_run_artifacts. Returns null when the run has no final answer
 * yet. Rewrites the file when missing or stale (run updated after the file
 * was written).
 */
export function ensureHaloReportFile(
  database: DatabaseHandle,
  runId: string,
): { path: string; sizeBytes: number } | null {
  const run = getHaloRun(database.sqlite, runId);
  if (!run || !run.finalAnswer?.trim()) return null;

  const outputDir = outputDirForRun(database.path, runId);
  const reportPath = join(outputDir, "report.md");
  const existing = existsSync(reportPath) ? statSync(reportPath) : null;
  const runUpdatedMs = Date.parse(run.updatedAt);
  const stale =
    !existing ||
    (Number.isFinite(runUpdatedMs) && existing.mtimeMs < runUpdatedMs);

  if (stale) {
    mkdirSync(outputDir, { recursive: true });
    const turns = listHaloRunTurns(database.sqlite, run);
    writeFileSync(reportPath, renderReportMarkdown(run, turns), "utf8");
  }

  const sizeBytes = statSync(reportPath).size;
  upsertReportArtifact(database.sqlite, runId, reportPath, sizeBytes);
  return { path: reportPath, sizeBytes };
}

export function listHaloRunArtifacts(
  sqlite: Database,
  runId: string,
): HaloRunArtifact[] {
  return sqlite
    .query<
      {
        artifact_type: string;
        created_at: number;
        id: string;
        path: string;
        run_id: string;
        size_bytes: number;
      },
      [string]
    >(
      `SELECT id, run_id, artifact_type, path, size_bytes, created_at
       FROM halo_run_artifacts
       WHERE run_id = ?
       ORDER BY created_at ASC`,
    )
    .all(runId)
    .map((row) => ({
      artifactType: row.artifact_type,
      createdAt: row.created_at,
      id: row.id,
      path: row.path,
      runId: row.run_id,
      sizeBytes: row.size_bytes,
    }));
}

function upsertReportArtifact(
  sqlite: Database,
  runId: string,
  path: string,
  sizeBytes: number,
) {
  const existing = sqlite
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM halo_run_artifacts WHERE run_id = ? AND artifact_type = ? LIMIT 1`,
    )
    .get(runId, REPORT_ARTIFACT_TYPE);
  if (existing) {
    sqlite
      .query(
        `UPDATE halo_run_artifacts SET path = ?, size_bytes = ? WHERE id = ?`,
      )
      .run(path, sizeBytes, existing.id);
    return;
  }
  sqlite
    .query(
      `INSERT INTO halo_run_artifacts (id, run_id, artifact_type, path, size_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), runId, REPORT_ARTIFACT_TYPE, path, sizeBytes, Date.now());
}

function renderReportMarkdown(run: HaloRun, turns: HaloRunTurn[]) {
  const startedAt = run.startedAt;
  const finishedAt = run.finishedAt;
  const lines = [
    `# HALO Analysis Report: ${run.title}`,
    "",
    `- **Run ID:** ${run.id}`,
    `- **Status:** ${run.status}`,
    `- **Target:** ${run.targetType === "session_group" ? "Session group" : "Trace group"}`,
    `- **Scope:** ${run.traceCount} traces · ${run.spanCount} spans${run.sessionCount > 0 ? ` · ${run.sessionCount} sessions` : ""}`,
    `- **Model:** ${run.model || "unknown"}${run.providerName ? ` (${run.providerName})` : ""}`,
    startedAt ? `- **Started:** ${startedAt}` : null,
    finishedAt ? `- **Finished:** ${finishedAt}` : null,
    "",
  ].filter((line): line is string => line !== null);

  // The full conversation: every prompt followed by HALO's findings for it.
  const exchanges = turns.filter(
    (turn) =>
      turn.role === "user" ||
      ((turn.status === "completed" || turn.status === "incomplete") &&
        turn.content.trim().length > 0),
  );
  let promptNumber = 0;
  const multiPrompt = exchanges.filter((turn) => turn.role === "user").length > 1;
  for (const turn of exchanges) {
    if (turn.role === "user") {
      promptNumber += 1;
      lines.push(
        multiPrompt
          ? `## Prompt ${promptNumber}`
          : "## Analysis prompt",
        "",
        "```",
        turn.content,
        "```",
        "",
      );
    } else {
      lines.push(
        multiPrompt ? `## Findings ${promptNumber}` : "## Findings",
        "",
        turn.content,
        "",
      );
    }
  }
  return lines.join("\n");
}
