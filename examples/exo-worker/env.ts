/**
 * Resolve ExoWorker env vars with one-release WorkerClaw compat fallbacks.
 * Prefer EXO_WORKER_*; fall back to WORKERCLAW_* when unset.
 */
export function exoWorkerEnv(name: string): string | undefined {
  const next = process.env[`EXO_WORKER_${name}`];
  if (next !== undefined && next !== "") {
    return next;
  }
  const legacy = process.env[`WORKERCLAW_${name}`];
  if (legacy !== undefined && legacy !== "") {
    return legacy;
  }
  return undefined;
}

export function exoWorkerEnvFlag(name: string): boolean {
  return exoWorkerEnv(name) === "true";
}
