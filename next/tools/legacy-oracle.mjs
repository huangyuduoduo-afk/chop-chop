// Executable oracle for the legacy Chopchop app (legacy/index.html + legacy/assets/v5*.js, formerly the repo root).
// Boots the real legacy code in jsdom with frozen time, no network, deterministic ids,
// so the new TypeScript merge implementation can be differential-tested against it.
//
// Run consumers with TZ=Asia/Shanghai. We also set process.env.TZ here, before any Date use
// in this module; Node re-reads TZ on assignment, so this works as long as no Date-dependent
// formatting happened earlier in the process (vitest forks worker processes, fine).
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..'); // next/tools -> next -> repo root
const read = (p) => readFileSync(resolve(REPO, p), 'utf8');

let cachedHtml = null;
function buildHtml() {
  if (cachedHtml) return cachedHtml;
  let html = read('legacy/index.html');
  // Escape "</script" inside inlined JS so it does not terminate the tag early.
  const inline = (path) => '<script>' + read(path).replace(/<\/script/gi, '<\\/script') + '</script>';
  let n = 0;
  html = html.replace(/<script\s+src="assets\/v5-preflight\.js[^"]*"\s*><\/script>/, () => (n++, inline('legacy/assets/v5-preflight.js')));
  html = html.replace(/<script\s+src="assets\/v5\.js[^"]*"\s*><\/script>/, () => (n++, inline('legacy/assets/v5.js')));
  if (n !== 2) throw new Error('legacy-oracle: expected to inline 2 asset scripts, inlined ' + n);
  // No external resources: strip every <link> (fonts, preconnect, stylesheet, manifest, icons).
  html = html.replace(/<link\b[^>]*>/gi, '');
  // Any remaining external <script src> would be a surprise.
  if (/<script\b[^>]*\bsrc=/i.test(html)) throw new Error('legacy-oracle: unexpected external <script src> left in index.html');
  cachedHtml = html;
  return html;
}

function seed(window, local) {
  for (const [k, v] of Object.entries(local || {})) {
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
}

function freezeTime(window, nowIso) {
  const RealDate = window.Date;
  const base = RealDate.parse(nowIso);
  if (!Number.isFinite(base)) throw new Error('legacy-oracle: bad now ' + nowIso);
  // Date.now() returns base + counter, counter increments by 1 per call, so ids built from
  // Date.now() stay unique and ordered. `new Date()` (no args) returns base + counter WITHOUT
  // incrementing. Everything else (Date.parse, Date.UTC, new Date(x)) is the real Date.
  let counter = 0;
  const FakeDate = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      if (args.length === 0) return Reflect.construct(target, [base + counter], newTarget);
      return Reflect.construct(target, args, newTarget);
    },
    get(target, prop, receiver) {
      if (prop === 'now') return () => base + counter++;
      return Reflect.get(target, prop, receiver);
    },
  });
  window.Date = FakeDate;
}

function installStubs(window, errors, warnings) {
  // Network: always rejected, calls recorded.
  window.__fetchCalls = [];
  window.fetch = (...args) => {
    window.__fetchCalls.push(args.map((a) => (typeof a === 'string' ? a : a && a.url ? a.url : String(a))));
    return Promise.reject(new Error('network disabled in oracle'));
  };
  class Noop { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  window.IntersectionObserver = Noop;
  window.ResizeObserver = Noop;
  window.MutationObserver = window.MutationObserver || Noop;
  window.matchMedia = (q) => ({
    matches: false, media: String(q), onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  });
  // Voice recognition intentionally absent (legacy checks for it).
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = undefined;
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async () => {}, readText: async () => '' },
  });
  window.scrollTo = () => {};
  window.scroll = () => {};
  window.Element.prototype.scrollIntoView = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () { return null; };
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => null;
  window.open = () => null;
  window.print = () => {};

  // Legacy builds ids (task_xxx, etc.) from Math.random(): replace with a seeded PRNG (mulberry32).
  let seedState = 0x9e3779b9;
  window.Math.random = () => {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Deterministic uuid v4-shaped ids (counter based) regardless of what jsdom provides.
  let u = 0;
  const randomUUID = () => {
    const hex = (++u).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
  const realCrypto = window.crypto;
  const fake = {
    randomUUID,
    getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = (i * 31 + ++u) & 0xff; return arr; },
    subtle: realCrypto && realCrypto.subtle,
  };
  Object.defineProperty(window, 'crypto', { configurable: true, value: fake });

  window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + String(e.reason && e.reason.stack || e.reason)));
  const origErr = window.console.error.bind(window.console);
  window.console.error = (...a) => { errors.push('console.error: ' + a.map(String).join(' ')); origErr(); };
  window.console.warn = (...a) => { warnings.push(a.map(String).join(' ')); };
}

const tick = () => new Promise((r) => setImmediate(r));

/**
 * Boot the legacy app. Returns { window, ls(), errors, warnings, close() }.
 * `local`: { qyx_key: value } seeded into localStorage before any script runs (non-strings are JSON.stringified).
 * Tip: top-level `let/const` of legacy scripts (e.g. `dead`, `log`) are not window props but
 * `window.eval('log')` (indirect eval) can read them.
 */
export async function openLegacy({ local = {}, now = '2026-10-24T09:00:00+08:00', tz = 'Asia/Shanghai' } = {}) {
  if (tz && process.env.TZ !== tz) process.env.TZ = tz;
  const errors = [];
  const warnings = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.stack ? e.stack : String(e))));
  virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  virtualConsole.on('warn', (...a) => warnings.push(a.map(String).join(' ')));

  const dom = new JSDOM(buildHtml(), {
    runScripts: 'dangerously',
    url: 'https://chopchop.test/',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      seed(window, local);
      freezeTime(window, now);
      installStubs(window, errors, warnings);
    },
  });
  const { window } = dom;
  // Let boot-time promises (syncNow -> rejected fetch, etc.) settle.
  for (let i = 0; i < 5; i++) await tick();

  const ls = () => {
    const out = {};
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('qyx_')) out[k] = window.localStorage.getItem(k);
    return out;
  };
  let closed = false;
  return {
    window, errors, warnings, ls,
    close() { if (!closed) { closed = true; window.close(); } }, // window.close() clears all timers
  };
}

function parseLs(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = JSON.parse(v); } catch { out[k] = v; }
  }
  return out;
}

// Move a window-realm value into the node realm (avoids cross-realm Array/Object identity quirks).
function toNode(v) {
  if (v === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
}

/**
 * Merge `cloud` (parsed chopchop-backup.json) into legacy `local` using the LIVE v5-wrapped
 * window.mergeAll, then export with window.collectBackup().
 * Returns { changed, backup (parsed object), backupRaw (string), ls (parsed qyx_*), lsRaw, errors }.
 */
export async function legacyMerge({ local = {}, cloud, now } = {}) {
  const h = await openLegacy({ local, ...(now ? { now } : {}) });
  try {
    const w = h.window;
    const cloudInWindow = w.JSON.parse(JSON.stringify(cloud)); // same realm as legacy code
    const changed = w.mergeAll(cloudInWindow);
    const backupRaw = w.collectBackup();
    const lsRaw = h.ls();
    return { changed, backup: JSON.parse(backupRaw), backupRaw, ls: parseLs(lsRaw), lsRaw, errors: h.errors.slice() };
  } finally {
    h.close();
  }
}

/**
 * Open legacy with `local`, run `await fn(window)`, return { result, ls (parsed), lsRaw, errors }.
 * `result` is JSON-normalised into the node realm when possible.
 */
export async function legacyCall({ local = {}, now, fn } = {}) {
  const h = await openLegacy({ local, ...(now ? { now } : {}) });
  try {
    const result = toNode(await fn(h.window));
    for (let i = 0; i < 3; i++) await tick();
    const lsRaw = h.ls();
    return { result, ls: parseLs(lsRaw), lsRaw, errors: h.errors.slice() };
  } finally {
    h.close();
  }
}
