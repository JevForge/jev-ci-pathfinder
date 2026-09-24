import type { JobDefinition } from '../schemas/pathfinder.js';

export function closeDependencies(
  selected: string[],
  jobs: JobDefinition[],
): { ids: string[]; added: string[] } {
  const needs = new Map(jobs.map(job => [job.id, job.needs]));
  const allow = new Set(jobs.map(job => job.id));
  const chosen = new Set(selected.filter(id => allow.has(id)));
  const initial = new Set(chosen);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...chosen]) {
      for (const need of needs.get(id) ?? []) {
        if (!chosen.has(need)) {
          chosen.add(need);
          changed = true;
        }
      }
    }
  }
  const ids = jobs.map(job => job.id).filter(id => chosen.has(id));
  const added = ids.filter(id => !initial.has(id));
  return { ids, added };
}

export function annotatePathHits(jobs: JobDefinition[], changedPaths: string[], match: (path: string, glob: string) => boolean): JobDefinition[] {
  return jobs.map(job => ({
    ...job,
    pathHit: job.paths.length > 0 && changedPaths.some(path => job.paths.some(glob => match(path, glob))),
  }));
}
