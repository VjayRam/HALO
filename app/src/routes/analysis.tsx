import { createFileRoute, redirect } from "@tanstack/react-router";

import { AnalysisPage } from "~/halo/AnalysisPage";

export const Route = createFileRoute("/analysis")({
  component: AnalysisPage,
  validateSearch: (search): { runId?: string } =>
    // Legacy deep links used ?runId=<id>; the detail view is a path now.
    typeof search.runId === "string" ? { runId: search.runId } : {},
  beforeLoad: ({ search }) => {
    if (search.runId) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ params: { runId: search.runId }, to: "/analysis/$runId" });
    }
  },
});
