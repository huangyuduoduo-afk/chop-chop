// Build the self-contained preview page (synthetic data, no cloud) as one HTML fragment for a
// claude.ai artifact: CSS, JS and the avatar inlined; no doctype/html/head/body (the host adds them).
// Usage: node tools/build-preview.mjs [outFile]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, 'dist-preview/chopchop-preview.html'));
execFileSync('npx', ['vite', 'build', '--mode', 'preview'], { cwd: root, stdio: 'inherit' });

const dist = resolve(root, 'dist-preview');
const assets = readdirSync(resolve(dist, 'assets'));
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(resolve(dist, 'assets', f), 'utf8')).join('\n');
let js = assets.filter((f) => f.endsWith('.js')).map((f) => readFileSync(resolve(dist, 'assets', f), 'utf8')).join('\n');
const avatar = 'data:image/jpeg;base64,' + readFileSync(resolve(root, 'public/avatar.jpg')).toString('base64');
js = js.replaceAll('"avatar.jpg"', JSON.stringify(avatar));
if (js.includes('</script')) js = js.replaceAll('</script', '<\\/script');

const html = `<title>Chopchop 预览</title>
<meta name="theme-color" content="#f4f8fd">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="app"></div>
<script type="module">${js}</script>
`;
writeFileSync(out, html);
console.log(`preview: ${out} (${(html.length / 1024).toFixed(0)} KB)`);
