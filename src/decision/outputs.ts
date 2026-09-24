export function buildMatrixOutput(runJobs: string[]): string {
  return JSON.stringify({ include: runJobs.map(job => ({ job })) });
}

export function buildJobIfSnippets(
  jobIds: string[],
  runJobsExpr = 'needs.pathfinder.outputs.run_jobs',
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of jobIds) {
    out[id] = `contains(fromJSON(${runJobsExpr}), '${id}')`;
  }
  return out;
}

export function formatIfSnippetsMarkdown(
  snippets: Record<string, string>,
  runJobs: string[],
): string {
  const lines = [
    '### Suggested job conditions',
    '',
    'Prefer `fromJSON(run_jobs)` over CSV — `contains` on a comma-separated string can match a job id prefix.',
    '',
  ];
  for (const id of Object.keys(snippets)) {
    const willRun = runJobs.includes(id);
    lines.push(`- \`${id}\` (${willRun ? 'run' : 'skip'}): \`if: ${snippets[id]}\``);
  }
  return lines.join('\n');
}
