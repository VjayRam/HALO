import { createFileRoute } from "@tanstack/react-router";

import { RunDetailPage } from "~/halo/RunDetailPage";

export const Route = createFileRoute("/analysis_/$runId")({
  component: RunDetailRoute,
});

function RunDetailRoute() {
  const { runId } = Route.useParams();
  return <RunDetailPage key={runId} runId={runId} />;
}
