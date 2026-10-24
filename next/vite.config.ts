import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

// `--mode preview` builds the self-contained demo (synthetic data, no cloud); see tools/build-preview.mjs.
export default defineConfig(({ mode }) => ({
  plugins: [
    preact(),
    { name: 'app-version', transformIndexHtml: (html: string) => html.replace('%APP_VERSION%', version) },
  ],
  define: { __APP_VERSION__: JSON.stringify(version), __PREVIEW__: JSON.stringify(mode === 'preview') },
  base: './',
  build: { target: 'es2022', outDir: mode === 'preview' ? 'dist-preview' : 'dist' },
  test: { globals: true, environment: 'node' },
}));
