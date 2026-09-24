export function buildMatrixOutput(runJobs: string[]): string {
  return JSON.stringify({ include: runJobs.map(job => ({ job })) });
}
