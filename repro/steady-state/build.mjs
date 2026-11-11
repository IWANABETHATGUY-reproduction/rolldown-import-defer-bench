// Builds case/main.js with rolldown (ROLLDOWN_DIST, see README.md), webpack and Rspack, minified
// ESM, into out/. Then: node run.mjs out/<tool>.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.ROLLDOWN_DIST) throw new Error('Set ROLLDOWN_DIST to the packages/rolldown/dist folder of a rolldown checkout (see README.md).');
const ROLLDOWN_DIST = resolve(process.env.ROLLDOWN_DIST);
const HERE = new URL('.', import.meta.url).pathname;
const { rolldown } = await import(pathToFileURL(join(ROLLDOWN_DIST, 'index.mjs')).href);
const req = createRequire(new URL('../../tools/package.json', import.meta.url));
const tools = { webpack: req('webpack'), rspack: req('@rspack/core').rspack };
const out = `${HERE}out`;
for (const pife of [false, true]) {
  const b = await rolldown({ input: `${HERE}case/main.js`, platform: 'neutral', experimental: { importDefer: true }, optimization: { pifeForModuleWrappers: pife } });
  const { output } = await b.generate({ format: 'esm', minify: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/rolldown${pife ? '-pife' : ''}.mjs`, output[0].code);
}
for (const [tool, fn] of Object.entries(tools)) {
  const cfg = { mode: 'production', context: `${HERE}case`, entry: { main: './main.js' }, target: ['webworker', 'es2022'], devtool: false,
    optimization: { minimize: true }, experiments: { outputModule: true, deferImport: true },
    output: { path: out, filename: `${tool}.mjs`, module: true, chunkFormat: 'module', library: { type: 'module' } } };
  const stats = await new Promise((r) => fn(cfg, (e, s) => r(e ?? s)));
  const errs = stats.toJson ? stats.toJson({ all: false, errors: true }).errors : [{ message: String(stats) }];
  if (errs.length) throw new Error(`${tool}: ${errs[0].message}`);
}
console.log('built');
