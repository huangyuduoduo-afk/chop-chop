import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [
    preact(),
    { name: 'app-version', transformIndexHtml: (html) => html.replace('%APP_VERSION%', version) },
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: './',
  build: { target: 'es2022' },
  test: { globals: true, environment: 'node' },
});
