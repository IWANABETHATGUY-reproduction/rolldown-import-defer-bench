// Full startup in workerd, measured from outside: the time from `new Miniflare()` to `mf.ready`,
// with the bundle as the main module (workerd loads, compiles and evaluates the global scope before
// it is ready). The same time for an empty Worker is the baseline. Fresh instance per run, configs
// interleaved and shuffled, run 0 is a warm-up.
// Usage: node scripts/workerd-ready.mjs [runs=30] [variant,... [out]]   (default out: results/timing-workerd-ready.json)
//   A variant can name its folder: `<folder>:<variant>` reads <folder>/<variant>/worker.mjs.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ROOT } from './config.mjs';

const RUNS = Number(process.argv[2] ?? 30);
const EMPTY = 'export default { fetch() { return new Response("ok"); } };';
const CONFIGS = [
  { key: 'empty', code: EMPTY },
  ...(process.argv[3]?.split(',') ?? ['eager', 'defer', 'eager-nomin', 'defer-nomin']).map((v) => {
    const [folder, variant] = v.includes(':') ? v.split(':') : ['dist', v];
    return { key: v, code: readFileSync(join(ROOT, folder, variant, 'worker.mjs'), 'utf8') };
  }),
].map((c) => ({ ...c, samples: [] }));

async function once(code) {
  const t0 = performance.now();
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: 'import-defer-bench', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    modulesRoot: '/', modules: [{ type: 'ESModule', path: '/worker.mjs', contents: code }], handleStructuredLogs: () => {},
  }));
  try {
    await mf.ready;
    const ms = performance.now() - t0;
    const res = await mf.dispatchFetch('https://example.com/');
    return { ms, status: res.status, body: (await res.text()).slice(0, 40) };
  } finally {
    await mf.dispose();
  }
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
for (let r = 0; r < RUNS + 1; r++) {
  for (const c of shuffle([...CONFIGS])) {
    const s = await once(c.code);
    if (s.status !== 200) console.log(`${c.key}: status ${s.status} ${s.body}`);
    if (r > 0) c.samples.push(s.ms);
  }
  if ((r + 1) % 5 === 0) process.stdout.write(`round ${r + 1}/${RUNS + 1}\n`);
}
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const base = q(CONFIGS[0].samples, 0.5);
const out = {
  meta: { runs: RUNS, date: new Date().toISOString(), method: 'new Miniflare() -> await mf.ready, bundle as main module, minus the empty Worker' },
  configs: CONFIGS.map((c) => ({ key: c.key, median: q(c.samples, 0.5), p25: q(c.samples, 0.25), p75: q(c.samples, 0.75), minusEmpty: q(c.samples, 0.5) - base, samples: c.samples })),
};
writeFileSync(resolve(ROOT, process.argv[4] ?? 'results/timing-workerd-ready.json'), JSON.stringify(out, null, 1));
console.log('config          median    p25    p75   minus empty   (ms)');
for (const c of out.configs) console.log(`${c.key.padEnd(24)} ${c.median.toFixed(1).padStart(7)} ${c.p25.toFixed(1).padStart(6)} ${c.p75.toFixed(1).padStart(6)}   ${c.minusEmpty.toFixed(1).padStart(8)}`);
