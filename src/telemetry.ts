export interface PathfinderTelemetry {
  duration_ms: number;
  provider: string;
  provisional: boolean;
  run_count: number;
  cache_hit: boolean;
  decision: string;
  decision_mode: string;
}

/** Structured log line — never include paths, secrets, or job names. */
export function formatTelemetryLine(event: PathfinderTelemetry): string {
  return JSON.stringify({ jev_ci_pathfinder_telemetry: event });
}
