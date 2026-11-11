// Builds the same app entries as scripts/build.mjs with webpack and Rspack, each with its own
// `import defer` implementation (`experiments.deferImport`). Run scripts/build.mjs first: it
// writes app/main.eager.js and app/main.defer.js.
// Writes dist/<tool>-<variant>/worker.mjs and results/builds-others.json.
// Usage: node scripts/build-others.mjs [tool...]   (tools: webpack, rspack)
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DEFINE, NODE_BUILTIN_RE, ROOT } from './config.mjs';

// The bundlers live in tools/, so that the app packages do not change.
const req = createRequire(join(ROOT, 'tools/package.json'));
const webpack = req('webpack');
const { rspack } = req('@rspack/core');
export const TOOLS = {
  webpack: { run: webpack, Define: webpack.DefinePlugin, version: req('webpack/package.json').version },
  rspack: { run: rspack, Define: rspack.DefinePlugin, version: req('@rspack/core/package.json').version },
};

// The same four builds as the rolldown `eager`, `defer`, `eager-nomin` and `defer-nomin`.
// `*-noconcat` (Rspack only): Rspack 2.3.1 drops the defer phase when the deferred module is the
// root of its own concatenated module, so its `defer` build evaluates the routes at startup.
// With module concatenation off, Rspack defers them.
const VARIANTS = {
  eager: { entry: 'main.eager.js', minimize: true },
  defer: { entry: 'main.defer.js', minimize: true },
  'eager-nomin': { entry: 'main.eager.js', minimize: false },
  'defer-nomin': { entry: 'main.defer.js', minimize: false },
  'eager-noconcat': { entry: 'main.eager.js', minimize: true, only: 'rspack', optimization: { concatenateModules: false } },
  'defer-noconcat': { entry: 'main.defer.js', minimize: true, only: 'rspack', optimization: { concatenateModules: false } },
};

// Parity with scripts/config.mjs:
// - the same conditions (webpack adds `module-sync` by default; rolldown does not), main fields
//   and browser field;
// - the same defines; cloudflare:* and Node builtins stay external;
// - one output file: no split chunks, no runtime chunk, and dynamic import() in the same chunk
//   (rolldown inlines dynamic imports when codeSplitting is false);
// - ESM output; the default minifier of each tool (webpack: terser, Rspack: SWC).
const CONDITIONS = ['workerd', 'worker', 'browser', 'module'];
export function config(tool, variant, outDir) {
  return {
    mode: 'production',
    context: ROOT,
    entry: { worker: `./app/${variant.entry}` },
    target: ['webworker', 'es2022'],
    devtool: false,
    performance: false,
    resolve: {
      conditionNames: CONDITIONS,
      mainFields: ['browser', 'module', 'main'],
      aliasFields: ['browser'],
      byDependency: {
        esm: { conditionNames: ['import', ...CONDITIONS] },
        commonjs: { conditionNames: ['require', ...CONDITIONS] },
      },
    },
    externalsType: 'module',
    externals: [({ request }, cb) => (request.startsWith('cloudflare:') || NODE_BUILTIN_RE.test(request) ? cb(null, `module ${request}`) : cb())],
    module: { parser: { javascript: { dynamicImportMode: 'eager' } } },
    plugins: [new TOOLS[tool].Define(DEFINE)],
    optimization: { minimize: variant.minimize, splitChunks: false, runtimeChunk: false, ...variant.optimization },
    experiments: { outputModule: true, deferImport: true },
    output: {
      path: outDir,
      filename: 'worker.mjs',
      module: true,
      chunkFormat: 'module',
      library: { type: 'module' },
      publicPath: '',
      clean: true,
    },
  };
}

export const run = (tool, cfg) => new Promise((resolve) => TOOLS[tool].run(cfg, (err, stats) => resolve({ err, stats })));

// Counts the source modules in the output. A concatenated module is named "<root> + <n> modules",
// and counts as n + 1. The nested list is a cross-check (both tools limit it by default, so the
// stats options set the limits to Infinity).
export function countModules(json) {
  let byName = 0;
  let nested = 0;
  for (const m of json.modules ?? []) {
    if (m.moduleType === 'runtime' || String(m.identifier ?? '').startsWith('webpack/runtime/') || m.orphan) continue;
    const plus = /\+ (\d+) modules?$/.exec(m.name ?? '');
    byName += plus ? Number(plus[1]) + 1 : 1;
    nested += m.modules?.length || 1;
  }
  return { byName, nested };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tools = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(TOOLS);
  const outFile = join(ROOT, 'results/builds-others.json');
  const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : { builds: {} };
  const builds = previous.builds;
  for (const tool of tools) {
    for (const [vname, variant] of Object.entries(VARIANTS)) {
      if (variant.only && variant.only !== tool) continue;
      const name = `${tool}-${vname}`;
      const outDir = join(ROOT, 'dist', name);
      const t0 = performance.now();
      const { err, stats } = await run(tool, config(tool, variant, outDir));
      const buildMs = performance.now() - t0;
      const json = stats?.toJson({ all: false, errors: true, warnings: true, modules: true, nestedModules: true, modulesSpace: Infinity, nestedModulesSpace: Infinity });
      const errors = err ? [err.message] : (json?.errors ?? []).map((e) => (e.message ?? String(e)).split('\n').slice(0, 3).join(' | '));
      if (errors.length) {
        builds[name] = { tool, version: TOOLS[tool].version, errors: errors.slice(0, 10) };
        console.log(`${name}: ${errors.length} errors\n  ${errors.slice(0, 5).join('\n  ')}`);
        continue;
      }
      const assets = readdirSync(outDir);
      const code = readFileSync(join(outDir, 'worker.mjs'), 'utf8');
      builds[name] = {
        tool,
        version: TOOLS[tool].version,
        file: `dist/${name}/worker.mjs`,
        assets,
        buildMs: Math.round(buildMs),
        bytes: Buffer.byteLength(code),
        gzipBytes: gzipSync(code).length,
        sha1: createHash('sha1').update(code).digest('hex'),
        moduleCount: countModules(json).byName,
        moduleCountNested: countModules(json).nested,
        warnings: (json.warnings ?? []).map((w) => (w.message ?? String(w)).split('\n').slice(0, 2).join(' | ')).slice(0, 10),
        importMetaLeft: (code.match(/import\.meta/g) ?? []).length,
        // Statement form only: unminified webpack and Rspack output keeps source comments.
        importDeferSyntaxLeft: /^\s*import\s+defer\s/m.test(code) || /\bimport\.defer\s*\(/.test(code),
        topLevelImports: [...code.matchAll(/^import\b[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]),
      };
    }
  }
  const meta = { date: new Date().toISOString(), node: process.version, tools: Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.version])) };
  writeFileSync(outFile, JSON.stringify({ meta, builds }, null, 1));
  console.log(JSON.stringify(meta));
  for (const [name, b] of Object.entries(builds)) {
    if (b.errors) { console.log(`${name.padEnd(20)} ERRORS ${b.errors.length}`); continue; }
    console.log(`${name.padEnd(20)} ${String(b.bytes).padStart(9)} B  gzip ${String(b.gzipBytes).padStart(8)} B  modules ${b.moduleCount} (nested ${b.moduleCountNested})  build ${b.buildMs} ms  assets ${b.assets.join(',')}  warnings ${b.warnings.length}  import.meta ${b.importMetaLeft}  importDeferLeft=${b.importDeferSyntaxLeft}  imports ${b.topLevelImports.join(',') || '-'}`);
  }
}
