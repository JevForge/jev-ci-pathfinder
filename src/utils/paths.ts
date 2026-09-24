import { isAbsolute, relative, resolve } from 'node:path';
import { toPosix } from './sanitize.js';

export function resolveInside(root: string, rel: string): string {
  if (rel.includes('\0')) throw new Error('Invalid path');
  const full = resolve(root, rel);
  const relTo = relative(root, full);
  if (relTo.startsWith('..') || isAbsolute(relTo)) {
    throw new Error('Path escapes the workspace');
  }
  return full;
}

export function normalizeRepoPath(input: string): string | null {
  let value = toPosix(input).trim();
  if (!value || value.includes('\0') || /[\r\n]/.test(value)) return null;
  if (value.startsWith('./')) value = value.slice(2);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return null;
  const parts = value.split('/');
  if (parts.some(part => part.length === 0 || part === '.' || part === '..')) return null;
  if (value.length > 512) return null;
  return value;
}

export function parseChangedPathsInput(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let items: unknown[];
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error('changed_paths is not valid JSON');
    }
    if (!Array.isArray(parsed)) throw new Error('changed_paths JSON must be an array');
    items = parsed;
  } else {
    items = trimmed.split(/\r?\n/);
  }
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') throw new Error('changed_paths entries must be strings');
    const normalized = normalizeRepoPath(item);
    if (!normalized) throw new Error('changed_paths contains an invalid path');
    out.push(normalized);
  }
  return [...new Set(out)].slice(0, 400);
}
