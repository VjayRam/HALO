import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "~/halo/SettingsPage";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
