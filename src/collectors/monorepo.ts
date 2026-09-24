import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { JOB_ID_PATTERN } from '../schemas/enums.js';
import { MonorepoPlanSchema, type MonorepoPlan, type PackageMap } from '../schemas/pathfinder.js';
import { anyPathMatch } from '../utils/globs.js';
import { toPosix } from '../utils/sanitize.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', 'build']);
const NAME_PATTERN = /^[A-Za-z0-9_@./-]{1,128}$/;

export interface DiscoveredProject {
  name: string;
  root: string;
}

export interface MonorepoEvidence {
  affectedProjects: string[];
  mappedJobIds: string[];
  droppedJobIds: string[];
  authoritative: boolean;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function workspaceGlobs(workspace: string): string[] {
  const globs: string[] = [];
  const pnpmPath = join(workspace, 'pnpm-workspace.yaml');
  if (existsSync(pnpmPath) && statSync(pnpmPath).size <= 256_000) {
    try {
      const doc = YAML.parse(readFileSync(pnpmPath, 'utf8')) as { packages?: unknown };
      if (Array.isArray(doc?.packages)) {
        for (const item of doc.packages) {
          if (typeof item === 'string' && item.length <= 256 && !item.includes('..')) globs.push(item);
        }
      }
    } catch {
      // Ignore unreadable workspace metadata. Explicit package maps still apply.
    }
  }
  const pkg = readJson(join(workspace, 'package.json')) as { workspaces?: unknown } | null;
  const workspaces = pkg?.workspaces;
  const list = Array.isArray(workspaces)
    ? workspaces
    : workspaces && typeof workspaces === 'object' && Array.isArray((workspaces as { packages?: unknown }).packages)
      ? (workspaces as { packages: unknown[] }).packages
      : [];
  for (const item of list) {
    if (typeof item === 'string' && item.length <= 256 && !item.includes('..')) globs.push(item);
  }
  return globs;
}

function walkProjects(workspace: string, globs: string[], nx: boolean): DiscoveredProject[] {
  const found: DiscoveredProject[] = [];
  const visit = (dir: string, depth: number) => {
    if (found.length >= 200 || depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = toPosix(relative(workspace, full));
      const matches = nx || globs.some(glob => {
        try {
          return anyPathMatch([rel], [glob]);
        } catch {
          return false;
        }
      });
      const packageJson = join(full, 'package.json');
      const projectJson = join(full, 'project.json');
      if (matches && (existsSync(packageJson) || existsSync(projectJson))) {
        const fromPackage = readJson(packageJson) as { name?: unknown } | null;
        const fromProject = readJson(projectJson) as { name?: unknown } | null;
        const name =
          typeof fromPackage?.name === 'string'
            ? fromPackage.name
            : typeof fromProject?.name === 'string'
              ? fromProject.name
              : entry.name;
        if (NAME_PATTERN.test(name)) found.push({ name, root: rel });
      }
      visit(full, depth + 1);
    }
  };
  visit(workspace, 0);
  return found;
}

export function discoverProjects(workspace: string): DiscoveredProject[] {
  const globs = workspaceGlobs(workspace);
  const nx = existsSync(join(workspace, 'nx.json'));
  if (globs.length === 0 && !nx) return [];
  return walkProjects(workspace, globs, nx && globs.length === 0);
}

export function parseMonorepoPlan(raw: string): MonorepoPlan {
  const trimmed = raw.trim();
  if (!trimmed) return { affected_projects: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('monorepo_plan is not valid JSON');
  }
  const result = MonorepoPlanSchema.safeParse(parsed);
  if (!result.success) throw new Error('monorepo_plan does not match the monorepo navigator contract');
  return result.data;
}

export function parseMonorepoPlanWithMeta(raw: string): {
  plan: MonorepoPlan;
  versioned: boolean;
} {
  const plan = parseMonorepoPlan(raw);
  return { plan, versioned: plan.plan_version === 1 };
}

export function buildMonorepoEvidence(input: {
  changedPaths: string[];
  packages: PackageMap[];
  allowlist: string[];
  discovered: DiscoveredProject[];
  plan: MonorepoPlan;
  authoritative: boolean;
}): MonorepoEvidence {
  const allow = new Set(input.allowlist);
  const affected = new Set<string>();
  for (const project of input.discovered) {
    if (input.changedPaths.some(path => path === project.root || path.startsWith(`${project.root}/`))) {
      affected.add(project.name);
    }
  }
  for (const pkg of input.packages) {
    if (anyPathMatch(input.changedPaths, pkg.paths)) affected.add(pkg.name);
  }
  for (const name of input.plan.affected_projects) {
    if (NAME_PATTERN.test(name)) affected.add(name);
  }

  const mapped = new Set<string>();
  const dropped: string[] = [];
  const remember = (jobId: string) => {
    if (!JOB_ID_PATTERN.test(jobId) || !allow.has(jobId)) {
      dropped.push(jobId.slice(0, 80));
      return;
    }
    mapped.add(jobId);
  };
  for (const pkg of input.packages) {
    if (!affected.has(pkg.name)) continue;
    for (const jobId of pkg.jobs) remember(jobId);
  }
  for (const step of input.plan.execution_plan ?? []) {
    if (!affected.has(step.project) && !input.plan.affected_projects.includes(step.project)) continue;
    for (const jobId of step.jobs) remember(jobId);
  }
  return {
    affectedProjects: [...affected].slice(0, 200),
    mappedJobIds: input.allowlist.filter(id => mapped.has(id)),
    droppedJobIds: [...new Set(dropped)].slice(0, 50),
    authoritative: input.authoritative,
  };
}
