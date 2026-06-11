import { createFileRoute } from "@tanstack/react-router";

import { ImportsPage } from "~/tracing/ImportsPage";

export const Route = createFileRoute("/imports")({
  component: ImportsPage,
});
