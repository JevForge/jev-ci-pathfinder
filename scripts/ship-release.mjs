#!/usr/bin/env node
/**
 * Local helper: wait for PR checks, squash-merge, dispatch Release, wait.
 * Usage: node scripts/ship-release.mjs <pr-number> <semver>
 */
import { execSync } from 'node:child_process';

const [pr, version] = process.argv.slice(2);
if (!pr || !version) {
  console.error('Usage: node scripts/ship-release.mjs <pr> <x.y.z>');
  process.exit(1);
}

function sh(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: true });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

try {
  sh(`gh pr checks ${pr} --watch`);
} catch {
  sleep(15_000);
  sh(`gh pr checks ${pr} --watch`);
}
sh(`gh pr merge ${pr} --squash --delete-branch`);
sh(`gh workflow run Release --ref main -f version=${version} -f move_major_tag=true`);
sleep(8_000);
const run = execSync('gh run list --workflow Release --limit 1 --json databaseId -q ".[0].databaseId"', {
  encoding: 'utf8',
  shell: true,
}).trim();
sh(`gh run watch ${run} --exit-status`);
sh(`gh release view v${version} --json url`);
