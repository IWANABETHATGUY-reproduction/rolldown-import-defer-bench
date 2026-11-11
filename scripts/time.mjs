// Startup timing in fresh Node processes.
// Each config is (variant, touch). It runs scripts/timing-runner.mjs in a NEW node process,
// `rounds` times. Rounds are interleaved, and the config order is shuffled in each round.
// The first `warmup` rounds are discarded.
// Usage: node scripts/time.mjs [--rounds 30] [--warmup 2] [--configs <variant>/<startup|touch>,...] [--out results/<file>.json]
//   A config can name its folder: `<folder>:<variant>/<touch>` reads <folder>/<variant>/worker.mjs.
//   The default folder is `dist` (or --dist <folder>, or BENCH_DIST).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './config.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const ROUNDS = Number(arg('--rounds', 30));
const WARMUP = Number(arg('--warmup', 2));
const DIST = arg('--dist', process.env.BENCH_DIST ?? 'dist');
const DEFAULT_CONFIGS = [
  ['eager', null], ['defer', null],
  ['eager', 'all'], ['defer', 'all'],
  ['defer', 'ai'], ['defer', 'graphql'], ['defer', 'ssr'], ['defer', 's3'],
  ['eager-nomin', null], ['defer-nomin', null],
  ['eager-nomin', 'all'], ['defer-nomin', 'all'],
];
const CONFIGS = (arg('--configs', null)?.split(',').map((c) => { const [v, t] = c.split('/'); return [v, t && t !== 'startup' ? t : null]; }) ?? DEFAULT_CONFIGS)
  .map(([name, touch]) => {
    const [folder, variant] = name.includes(':') ? name.split(':') : [DIST, name];
    return { key: `${name}/${touch ?? 'startup'}`, folder, variant, touch, samples: [], errors: [] };
  });
const OUT = arg('--out', 'results/timing-node.json');

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const t0 = Date.now();
for (let round = 0; round < ROUNDS + WARMUP; round++) {
  for (const c of shuffle([...CONFIGS])) {
    const args = ['--experimental-vm-modules', '--no-warnings', join(ROOT, 'scripts/timing-runner.mjs'), join(ROOT, c.folder, c.variant, 'worker.mjs')];
    if (c.touch) args.push('--touch', c.touch);
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT });
    let out;
    try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { out = { ok: false, error: `bad output: ${r.stdout.slice(0, 300)} ${r.stderr.slice(0, 300)}` }; }
    if (round < WARMUP) continue;
    if (out.ok) c.samples.push({ compileMs: out.compileMs, linkMs: out.linkMs, evaluateMs: out.evaluateMs, touchMs: out.touchMs ?? 0, totalMs: out.totalMs, allMs: out.totalMs + (out.touchMs ?? 0) });
    else c.errors.push(out.error);
  }
  process.stdout.write(`round ${round + 1}/${ROUNDS + WARMUP} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const stats = (xs) => ({ median: q(xs, 0.5), p25: q(xs, 0.25), p75: q(xs, 0.75), min: Math.min(...xs), max: Math.max(...xs), n: xs.length });
const result = {
  meta: { node: process.version, v8: process.versions.v8, rounds: ROUNDS, warmup: WARMUP, date: new Date().toISOString(),
    method: 'vm.SourceTextModule compile + evaluate (+ __touch), one fresh node process per sample' },
  configs: CONFIGS.map((c) => ({
    key: c.key, errors: [...new Set(c.errors)],
    ...Object.fromEntries(['compileMs', 'linkMs', 'evaluateMs', 'touchMs', 'totalMs', 'allMs'].map((k) => [k, c.samples.length ? stats(c.samples.map((s) => s[k])) : null])),
  })),
};
writeFileSync(resolve(ROOT, OUT), JSON.stringify(result, null, 1));
const f = (x) => (x == null ? '-' : x.median.toFixed(2).padStart(7));
console.log('config                          compile  evaluate    touch  startup  startup+touch     link   (medians, ms; link is not in startup)');
for (const c of result.configs) {
  if (c.errors.length) console.log(`${c.key} ERROR ${c.errors[0]}`);
  console.log(`${c.key.padEnd(30)} ${f(c.compileMs)}  ${f(c.evaluateMs)}  ${f(c.touchMs)}  ${f(c.totalMs)}  ${f(c.allMs)}  ${f(c.linkMs)}`);
}
