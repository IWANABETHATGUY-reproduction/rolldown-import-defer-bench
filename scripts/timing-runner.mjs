// Child process: load ONE bundle as an ES module with node:vm and time its phases.
//   compile  = new vm.SourceTextModule(code)          (V8 parse + top-level bytecode compile)
//   link     = module.link(...)                        (builtin/stub modules; excluded from totals)
//   evaluate = module.evaluate()                       (global-scope evaluation of the Worker)
// Prints one JSON line. Run with: node --experimental-vm-modules scripts/timing-runner.mjs <bundle> [--touch <route|all>]
//
// Notes:
// - Node builtins imported by the bundle (node:*) are provided as SyntheticModules wrapping the real
//   builtin, loaded during `link` (so builtin loading is not attributed to compile/evaluate).
// - cloudflare:* modules are stubbed (only cloudflare:node.httpServerHandler is needed).
// - No `require` global is defined, as in workerd.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const file = process.argv[2];
const touchIdx = process.argv.indexOf('--touch');
const touch = touchIdx === -1 ? null : process.argv[touchIdx + 1];

const stubs = {
  'cloudflare:node': {
    httpServerHandler: (server) => ({
      async fetch() {
        return new Response(`stubbed httpServerHandler (${typeof server?.listen})`);
      },
    }),
    handleAsNodeRequest: () => new Response('stub'),
  },
  'cloudflare:workers': { env: {}, WorkerEntrypoint: class {}, DurableObject: class {} },
};

const cache = new Map();
async function loadDep(specifier) {
  if (cache.has(specifier)) return cache.get(specifier);
  const ns = specifier.startsWith('cloudflare:') ? stubs[specifier] : await import(specifier);
  if (!ns) throw new Error(`no module for ${specifier}`);
  const keys = Object.keys(ns);
  const m = new vm.SyntheticModule(keys, function () {
    for (const k of keys) this.setExport(k, ns[k]);
  }, { identifier: specifier });
  cache.set(specifier, m);
  return m;
}

// Pre-initialize Node's lazily-loaded web globals (undici fetch classes, web streams, WebCrypto,
// navigator, ...). In workerd these are native and already initialized; in Node the first touch can
// cost several ms and would otherwise be charged to whichever bundle touches them first.
// Disable with PREWARM=0.
function prewarm() {
  const names = ['fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'ReadableStream', 'WritableStream',
    'TransformStream', 'ByteLengthQueuingStrategy', 'CountQueuingStrategy', 'TextEncoderStream', 'TextDecoderStream',
    'CompressionStream', 'DecompressionStream', 'AbortController', 'AbortSignal', 'EventTarget', 'Event', 'CustomEvent',
    'MessageChannel', 'MessagePort', 'MessageEvent', 'BroadcastChannel', 'WebSocket', 'EventSource', 'DOMException',
    'structuredClone', 'crypto', 'CryptoKey', 'SubtleCrypto', 'performance', 'navigator', 'Navigator', 'URL', 'URLSearchParams',
    'URLPattern', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'WebAssembly'];
  for (const n of names) { try { void globalThis[n]; } catch {} }
  new Request('https://example.com/', { method: 'POST', body: 'x', headers: { a: 'b' } });
  new Response('x', { headers: new Headers({ a: 'b' }) });
  new ReadableStream({ start(c) { c.close(); } }).getReader();
  new TransformStream();
  new TextEncoder().encode('x'); new TextDecoder().decode(new Uint8Array([120]));
  crypto.getRandomValues(new Uint8Array(4)); void crypto.subtle; crypto.randomUUID();
  new AbortController(); new FormData(); new Blob(['x']); new URL('https://example.com/?a=1');
  structuredClone({ a: 1 }); void navigator.userAgent;
}
if (process.env.PREWARM !== '0') prewarm();

const code = readFileSync(file, 'utf8');
const out = { file, bytes: Buffer.byteLength(code) };
try {
  const t0 = performance.now();
  const mod = new vm.SourceTextModule(code, {
    identifier: `file://${file}`,
    importModuleDynamically: async (spec) => {
      const m = await loadDep(spec);
      if (m.status === 'unlinked') await m.link(() => {});
      if (m.status !== 'evaluated') await m.evaluate();
      return m;
    },
  });
  const t1 = performance.now();
  await mod.link(loadDep);
  const t2 = performance.now();
  await mod.evaluate();
  const t3 = performance.now();
  Object.assign(out, { ok: true, compileMs: t1 - t0, linkMs: t2 - t1, evaluateMs: t3 - t2, totalMs: (t1 - t0) + (t3 - t2) });

  // First use of deferred routes: `__touch` reads `default` of one route namespace (or of all).
  // With `import defer`, that read evaluates the route module and its dependencies.
  if (touch) {
    const t4 = performance.now();
    out.touchResult = mod.namespace.__touch(touch);
    out.touchMs = performance.now() - t4;
  }
} catch (e) {
  out.ok = false;
  out.error = String(e?.stack ?? e).split('\n').slice(0, 6).join('\n');
}
process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
