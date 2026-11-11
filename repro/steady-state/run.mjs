// Usage: node run.mjs <bundle> ; prints the best of 7 runs (ns per read) for each loop.
const mod = await import(new URL(process.argv[2], `file://${process.cwd()}/`).href);
const N = 2e7;
mod.runStatic(10); mod.runEscaped(10); mod.bumpAll();
const out = {};
for (const k of ['runEager', 'runStatic', 'runEagerEscaped', 'runEscaped']) {
  let best = Infinity, r;
  for (let i = 0; i < 7; i++) { const t = performance.now(); r = mod[k](N); best = Math.min(best, performance.now() - t); }
  if (r !== 2 * N) throw new Error(`${k}: wrong sum ${r}`);
  out[k] = +(best * 1e6 / N).toFixed(2);
}
console.log(JSON.stringify(out));
