import { existsSync, readdirSync } from 'node:fs';
import { CI_TOOLS, type CiTool } from '../schemas/enums.js';
import { readBounded } from './config.js';
import { resolveInside } from '../utils/paths.js';
import {
  emptyInventory,
  inventoryFromJobs,
  parseCircleCi,
  parseGithubWorkflow,
  parseJenkinsfile,
  type CiInventory,
  type CiJobSeen,
} from './workflows.js';

export function parseCiTools(raw: string | undefined): CiTool[] {
  const value = raw?.trim() || 'github-actions';
  const tools = value.split(',').map(item => item.trim()).filter(Boolean);
  if (tools.length === 0) return ['github-actions'];
  for (const tool of tools) {
    if (!CI_TOOLS.includes(tool as CiTool)) throw new Error(`Unsupported ci_tools entry: ${tool}`);
  }
  return [...new Set(tools)] as CiTool[];
}

export function readCiInventory(workspace: string, tools: CiTool[], workflowsDir: string): CiInventory {
  const jobs: CiJobSeen[] = [];
  if (tools.includes('github-actions')) {
    const dir = resolveInside(workspace, workflowsDir);
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
        const content = readBounded(workspace, `${workflowsDir.replace(/\\/g, '/')}/${name}`);
        if (content) jobs.push(...parseGithubWorkflow(name, content));
      }
    }
  }
  if (tools.includes('circleci')) {
    const content = readBounded(workspace, '.circleci/config.yml');
    if (content) jobs.push(...parseCircleCi(content));
  }
  if (tools.includes('jenkins')) {
    const content = readBounded(workspace, 'Jenkinsfile');
    if (content) jobs.push(...parseJenkinsfile(content));
  }
  return jobs.length ? inventoryFromJobs(jobs) : emptyInventory();
}
