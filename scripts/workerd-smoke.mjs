// Runs the same requests as smoke.mjs against each bundle in workerd (Miniflare), and compares
// the status and the body. A wrapper module imports the bundle inside `fetch`.
// Usage: node scripts/workerd-smoke.mjs [variant...]
//   A variant can name its folder: `<folder>:<variant>` reads <folder>/<variant>/worker.mjs.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';

export const WRAPPER = `let mod;
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    mod ??= await import("worker.mjs");
    if (url.pathname === "/__startup") return new Response("ok");
    if (url.pathname === "/__touch") return new Response(String(mod.__touch(url.searchParams.get("name"))));
    return mod.default.fetch(request, env, ctx);
  },
};`;

export function createMiniflare(code, extra = {}) {
  return new Miniflare(convertV4MiniflareOptions({
    name: 'import-defer-bench',
    compatibilityDate: '2026-10-01',
    compatibilityFlags: ['nodejs_compat'],
    modulesRoot: '/',
    modules: [
      { type: 'ESModule', path: '/wrapper.mjs', contents: WRAPPER },
      { type: 'ESModule', path: '/worker.mjs', contents: code },
    ],
    handleStructuredLogs: () => {},
    ...extra,
  }));
}

const REQUESTS = [
  ['GET', '/'],
  ['GET', '/graphql?query=%7Bhello%7D'],
  ['POST', '/graphql', '{"query":"{ user(id: 7) { id name } }"}'],
  ['GET', '/ssr?n=3'],
  ['GET', '/api/todos'],
  ['POST', '/api/todos', '{"title":""}'],
  ['GET', '/__touch?name=all'],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const variants = process.argv.length > 2 ? process.argv.slice(2) : ['eager', 'defer'];
  const results = {};
  for (const v of variants) {
    const [folder, variant] = v.includes(':') ? v.split(':') : ['dist', v];
    const mf = createMiniflare(readFileSync(join(ROOT, folder, variant, 'worker.mjs'), 'utf8'));
    try {
      await mf.ready;
      results[v] = [];
      for (const [method, path, body] of REQUESTS) {
        const res = await mf.dispatchFetch('https://example.com' + path, { method, body, headers: body ? { 'content-type': 'application/json' } : {} });
        results[v].push(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 160)}`);
      }
    } catch (e) {
      results[v] = [`ERROR: ${String(e?.stack ?? e).slice(0, 800)}`];
    } finally {
      await mf.dispose();
    }
  }
  for (const v of variants) console.log(`--- ${v}\n  ${results[v].join('\n  ')}`);
  const same = variants.every((v) => JSON.stringify(results[v]) === JSON.stringify(results[variants[0]]));
  console.log(`same output in ${variants.join(', ')}: ${same}`);
}
