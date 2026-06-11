import { INGEST_PORT, LIVE_WS_PORT } from "./telemetry/types";

/**
 * Resolve server ports from the environment. Defaults stay at 8799/8800 so
 * packaged-app users who already point agents at the documented endpoint are
 * unaffected; the env vars exist so dev setups can dodge port conflicts
 * (wrangler dev, a second HALO instance, etc.).
 */
export function resolveServerPorts(env: Record<string, string | undefined> = process.env) {
  return {
    ingestPort: parsePort(env.HALO_INGEST_PORT) ?? INGEST_PORT,
    liveWsPort: parsePort(env.HALO_LIVE_WS_PORT) ?? LIVE_WS_PORT,
  };
}

function parsePort(raw: string | undefined) {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid port "${raw}" — expected an integer between 1 and 65535.`);
  }
  return value;
}
