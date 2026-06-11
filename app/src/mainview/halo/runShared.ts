import type { HaloRun, HaloRunTargetType } from "../../server/halo/types";

/** Run shape returned over tRPC — filters arrive untyped. */
export type HaloRunView = Omit<HaloRun, "filters"> & { filters: unknown };

export function targetLabel(targetType: HaloRunTargetType) {
  return targetType === "session_group" ? "Session group" : "Trace group";
}
