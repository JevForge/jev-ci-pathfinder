import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listYamlFiles(full));
    else if (/\.ya?ml$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function collectWithKeys(text: string): string[] {
  const keys: string[] = [];
  const blocks = text.matchAll(/\bwith:\s*\n((?:[ \t]+[A-Za-z_][A-Za-z0-9_]*:[^\n]*\n)+)/g);
  for (const match of blocks) {
    for (const line of match[1].split('\n')) {
      const key = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/)?.[1];
      if (key) keys.push(key);
    }
  }
  return keys;
}

function collectOutputRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/outputs\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    refs.add(match[1]);
  }
  return [...refs];
}

function loadActionKeys(actionYml: string): { inputs: Set<string>; outputs: Set<string> } {
  const inputsBlock = actionYml.match(/^inputs:\n([\s\S]*?)^outputs:/m)?.[1] ?? '';
  const outputsBlock = actionYml.match(/^outputs:\n([\s\S]*?)^runs:/m)?.[1] ?? '';
  const keys = (block: string) =>
    new Set(
      [...block.matchAll(/^  ([A-Za-z_][A-Za-z0-9_]*):/gm)].map(match => match[1]),
    );
  return { inputs: keys(inputsBlock), outputs: keys(outputsBlock) };
}

describe('example contract vs action.yml', () => {
  it('only references declared inputs and outputs', () => {
    const actionYml = readFileSync(join(process.cwd(), 'action.yml'), 'utf8');
    const { inputs: declaredInputs, outputs: declaredOutputs } = loadActionKeys(actionYml);
    expect(declaredInputs.size).toBeGreaterThan(0);
    expect(declaredOutputs.size).toBeGreaterThan(0);

    const examplesRoot = join(process.cwd(), 'examples');
    const files = listYamlFiles(examplesRoot);
    expect(files.length).toBeGreaterThan(0);

    const unknownInputs: string[] = [];
    const unknownOutputs: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!/\bjobs\s*:/.test(text) && !/\bon\s*:/.test(text) && !/\buses\s*:/.test(text)) {
        continue;
      }
      const fenced = [...text.matchAll(/```ya?ml\n([\s\S]*?)```/g)].map(m => m[1]);
      const bodies = fenced.length > 0 ? fenced : [text];
      for (const body of bodies) {
        if (!body.includes('jev-ci-pathfinder')) continue;
        for (const key of collectWithKeys(body)) {
          if (!declaredInputs.has(key)) unknownInputs.push(`${file}: input ${key}`);
        }
        for (const key of collectOutputRefs(body)) {
          if (!declaredOutputs.has(key)) unknownOutputs.push(`${file}: output ${key}`);
        }
      }
    }

    expect(unknownInputs).toEqual([]);
    expect(unknownOutputs).toEqual([]);
  });
});
