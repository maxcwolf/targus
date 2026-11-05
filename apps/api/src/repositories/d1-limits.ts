/** D1 binds at most 100 parameters per statement. */
export const d1MaxBoundParameters = 100;

/** Split rows for multi-row inserts so no statement binds more than D1 allows. */
export function chunkForD1<T>(rows: readonly T[], parametersPerRow: number): T[][] {
  const size = Math.max(1, Math.floor(d1MaxBoundParameters / parametersPerRow));
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }
  return chunks;
}
