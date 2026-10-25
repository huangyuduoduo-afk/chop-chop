// Build the app and place it at the repo root, which GitHub Pages serves (branch main, path /).
// The 5.x app lives in legacy/ and is left untouched. Usage: node tools/release.mjs
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const next = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(next, '..');
execFileSync('npx', ['vite', 'build'], { cwd: next, stdio: 'inherit' });

// Drop the previous release's hashed bundles; keep anything else in assets/.
const assets = resolve(repo, 'assets');
if (existsSync(assets)) for (const f of readdirSync(assets)) if (/^index-[\w-]+\.(js|css)$/.test(f)) rmSync(resolve(assets, f));

cpSync(resolve(next, 'dist'), repo, { recursive: true });
writeFileSync(resolve(repo, '.nojekyll'), ''); // serve files as-is, no Jekyll pass
console.log('release copied to', repo);
