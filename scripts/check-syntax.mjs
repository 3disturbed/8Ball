// Zero-dependency lint gate: every .js/.mjs file in the repo must parse.
// (The box has no eslint and 229MB free RAM — node --check is free.)
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', 'data', 'db', 'docs']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (['.js', '.mjs'].includes(extname(name))) yield full;
  }
}

let count = 0;
let failed = 0;
for (const file of walk(ROOT)) {
  count += 1;
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failed += 1;
    console.error(`SYNTAX ${file}\n${error.stderr}`);
  }
}
if (failed > 0) {
  console.error(`check-syntax: ${failed}/${count} files failed`);
  process.exit(1);
}
console.log(`check-syntax: ${count} files OK`);
