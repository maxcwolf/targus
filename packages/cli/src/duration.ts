/** A duration for an error message: `250ms`, `30s`, `1.5s`, `5m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${Number(seconds.toFixed(1))}s`;
}
