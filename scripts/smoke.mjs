// Runs the same requests against each bundle (one fresh Node process per bundle) and compares
// the status and the body. Usage: node scripts/smoke.mjs [variant...]
//   A variant can name its folder: `<folder>:<variant>` reads <folder>/<variant>/worker.mjs.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './config.mjs';

const REQUESTS = [
  ['GET', '/'],
  ['GET', '/graphql?query=%7Bhello%7D'],
  ['POST', '/graphql', '{"query":"{ user(id: 7) { id name } }"}'],
  ['GET', '/ssr?n=3'],
  ['GET', '/api/todos'],
  ['POST', '/api/todos', '{"title":""}'],
];

if (process.argv[2] === '--child') {
  const [folder, variant] = process.argv[3].includes(':') ? process.argv[3].split(':') : ['dist', process.argv[3]];
  const mod = await import(pathToFileURL(join(ROOT, folder, variant, 'worker.mjs')).href);
  const out = [];
  for (const [method, path, body] of REQUESTS) {
    const req = new Request('https://example.com' + path, { method, body, headers: body ? { 'content-type': 'application/json' } : {} });
    const res = await mod.default.fetch(req, { DB: undefined }, { waitUntil() {}, passThroughOnException() {} });
    out.push(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  out.push(`__touch(all) -> ${mod.__touch('all')}`);
  console.log(JSON.stringify(out));
  process.exit(0);
}

const variants = process.argv.length > 2 ? process.argv.slice(2) : ['eager', 'defer'];
const results = {};
for (const v of variants) {
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--child', v], { encoding: 'utf8' });
  try { results[v] = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { results[v] = [`ERROR: ${r.stdout.slice(-400)} ${r.stderr.slice(-800)}`]; }
}
for (const v of variants) console.log(`--- ${v}\n  ${results[v].join('\n  ')}`);
const same = variants.every((v) => JSON.stringify(results[v]) === JSON.stringify(results[variants[0]]));
console.log(`same output in ${variants.join(', ')}: ${same}`);
