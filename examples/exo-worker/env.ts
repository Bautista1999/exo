/**
 * Resolve `EXO_WORKER_<name>` from the environment.
 */
export function exoWorkerEnv(name: string): string | undefined {
  const value = process.env[`EXO_WORKER_${name}`];
  if (value !== undefined && value !== "") {
    return value;
  }
  return undefined;
}

export function exoWorkerEnvFlag(name: string): boolean {
  return exoWorkerEnv(name) === "true";
}
