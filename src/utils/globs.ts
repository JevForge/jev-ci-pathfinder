const compiled = new Map<string, RegExp>();

export function assertSafeGlob(pattern: string): void {
  if (pattern.length < 1 || pattern.length > 256) {
    throw new Error(`Glob length is not allowed: ${pattern.slice(0, 40)}`);
  }
  if (/[\r\n\0\[\]{}!\\]/.test(pattern) || pattern.includes('..')) {
    throw new Error(`Unsupported glob syntax: ${pattern}`);
  }
}

export function compileGlob(glob: string): RegExp {
  const cached = compiled.get(glob);
  if (cached) return cached;
  const pattern = glob.includes('/') ? glob : `**/${glob}`;
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    if (pattern.startsWith('**/', index)) {
      expression += '(?:.*/)?';
      index += 3;
      continue;
    }
    if (pattern.startsWith('**', index)) {
      expression += '.*';
      index += 2;
      continue;
    }
    const char = pattern[index]!;
    index += 1;
    if (char === '*') {
      expression += '[^/]*';
      continue;
    }
    if (char === '?') {
      expression += '[^/]';
      continue;
    }
    expression += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  const regex = new RegExp(`^${expression}$`);
  compiled.set(glob, regex);
  return regex;
}

export function matchPath(repoPath: string, glob: string): boolean {
  return compileGlob(glob).test(repoPath);
}

export function anyPathMatch(repoPaths: string[], globs: string[]): boolean {
  if (globs.length === 0 || repoPaths.length === 0) return false;
  return repoPaths.some(repoPath => globs.some(glob => matchPath(repoPath, glob)));
}
