// Worker-like build configuration: ESM output in one file, like the output of wrangler.
// - rolldown and esmExternalRequirePlugin come from a rolldown build with `import defer`
//   (ROLLDOWN_DIST), not from node_modules. Only the builds need it;
// - `experimental.importDefer` is on for every build;
// - logs are collected (onLog), not hidden.
import { builtinModules } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// The packages/rolldown/dist folder of a rolldown checkout (see README.md).
export const ROLLDOWN_DIST = process.env.ROLLDOWN_DIST && resolve(process.env.ROLLDOWN_DIST);
const load = (file) => (ROLLDOWN_DIST ? import(pathToFileURL(join(ROLLDOWN_DIST, file)).href) : {});
export const { rolldown, VERSION: ROLLDOWN_VERSION } = await load('index.mjs');
const { esmExternalRequirePlugin } = await load('plugins-index.mjs');

const builtinNames = [...new Set(builtinModules.filter((m) => !m.startsWith('_')))];
export const NODE_BUILTIN_RE = new RegExp(`^(node:.*|${builtinNames.map((m) => m.replace(/[/]/g, '\\/')).join('|')})$`);

export const DEFINE = {
  'process.env.NODE_ENV': '"production"',
  'global.process.env.NODE_ENV': '"production"',
  'globalThis.process.env.NODE_ENV': '"production"',
  'navigator.userAgent': '"Cloudflare-Workers"',
};
export const TARGET = 'es2024';

export function rolldownInputOptions(entry, logs, extra = {}) {
  return {
    input: entry,
    cwd: ROOT,
    platform: 'neutral',
    treeshake: true,
    external: (id) => id.startsWith('cloudflare:'),
    resolve: {
      conditionNames: ['workerd', 'worker', 'browser', 'module'],
      mainFields: ['browser', 'module', 'main'],
      aliasFields: [['browser']],
    },
    transform: { target: TARGET, define: DEFINE },
    experimental: { importDefer: true },
    onLog(level, log) {
      logs.push({ level, code: log.code, message: log.message });
    },
    plugins: [esmExternalRequirePlugin({ external: [NODE_BUILTIN_RE], skipDuplicateCheck: true })],
    ...extra,
  };
}

export function rolldownOutputOptions(minify = true) {
  return {
    format: 'esm',
    minify,
    codeSplitting: false, // one file, like wrangler/esbuild output
    comments: { legal: true, annotation: false, jsdoc: false },
    sourcemap: false,
  };
}

// The builds. `eager` and `defer` differ only in the phase of the four route imports.
// `*-nomin` builds turn minify off (the wrangler default).
// `platform: 'neutral'` makes optimization.pifeForModuleWrappers default to false, so the main
// builds have no `((...) => {...})` eager-compile hint on ESM module wrappers. Other platforms
// default to true; the `*-pife` builds turn it on.
// On branch feat/import-defer-pife, the wrappers of the deferred modules get the hint also on
// `neutral`. In this bench all ESM wrappers are deferred wrappers, so `defer` gives the
// `defer-pife` output. `defer-nopife` sets the option to false, which turns off the hint also on
// the deferred wrappers.
export const VARIANTS = {
  eager: { phase: '', minify: true, extra: {} },
  defer: { phase: 'defer ', minify: true, extra: {} },
  'eager-nomin': { phase: '', minify: false, extra: {} },
  'defer-nomin': { phase: 'defer ', minify: false, extra: {} },
  'eager-pife': { phase: '', minify: true, extra: { optimization: { pifeForModuleWrappers: true } } },
  'defer-pife': { phase: 'defer ', minify: true, extra: { optimization: { pifeForModuleWrappers: true } } },
  'defer-nopife': { phase: 'defer ', minify: true, extra: { optimization: { pifeForModuleWrappers: false } } },
};
