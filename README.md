# Startup bench for `import defer` in Rolldown: a Hono app for workerd with four deferred routes

This bench measures how much `import defer` makes the startup of a bundle faster. It compares Rolldown with webpack 5.112.2. The app is a composite of open-source packages, not a real app.

- The core API (Hono, zod and drizzle-orm) is eager.
- The entry imports each of the four routes with `import defer * as`: the AI SDK (`/ai`), GraphQL Yoga (`/graphql`), React server rendering (`/ssr`) and `@aws-sdk/client-s3` (`/s3/*`).
- `app/main.template.js` is the source of the entry. `scripts/build.mjs` writes `app/main.eager.js` (plain imports) and `app/main.defer.js` (`import defer`) from it.

## Results

| Build                              | Startup, Node.js | Startup, workerd | First use of all 4 routes | Startup + all 4 routes | Size                 |
| ---------------------------------- | ---------------- | ---------------- | ------------------------- | ---------------------- | -------------------- |
| Rolldown, no `import defer`        | 35.8 ms          | 59.4 ms          | 0 ms                      | 35.8 ms                | 1,391,118 B          |
| Rolldown + `import defer`          | 19.5 ms (−46%)   | 20.1 ms (−66%)   | 18.3 ms                   | 38.0 ms (+6%)          | 1,394,736 B (+0.26%) |
| webpack 5.112.2, no `import defer` | 36.4 ms          | 59.0 ms          | 0 ms                      | 36.5 ms                | 1,414,291 B          |
| webpack 5.112.2 + `import defer`   | 19.0 ms          | 20.5 ms          | 21.2 ms                   | 40.5 ms                | 1,426,390 B          |

| Route      | Rolldown, first use | webpack, first use |
| ---------- | ------------------- | ------------------ |
| `/ai`      | 8.4 ms              | 8.8 ms             |
| `/graphql` | 6.2 ms              | 6.2 ms             |
| `/s3/*`    | 3.4 ms              | 3.0 ms             |
| `/ssr`     | 1.1 ms              | 3.5 ms             |

- Each build is one minified file (`codeSplitting: false`, `platform: 'neutral'`). webpack uses terser.
- Node.js 26.8.1 (V8 14.6): `vm.SourceTextModule` compiles and evaluates the file (`scripts/timing-runner.mjs`). Each sample uses a new process. Each build gets 2 warm-up samples, then 30 samples. The values are medians.
- "First use" is the time to read the `default` export of the deferred namespace of a route, after startup. This read evaluates the route and its deferred closure.
- workerd: the value is the time from `new Miniflare()` to `await mf.ready`, minus the time of an empty Worker (`scripts/workerd-ready.mjs`). The values are medians of 30 samples.
- The run was on 2026-11-10, on an Apple M3 Pro.

### PIFE on the deferred wrappers

A PIFE is a function expression in parentheses. V8 compiles it eagerly. On the branch, the init wrapper of a deferred module is a PIFE on all platforms by default. The same run measured two `import defer` builds from before this change and before the other startup changes, so they are slower than the final build:

| Build                     | Startup | First use of all 4 routes |
| ------------------------- | ------- | ------------------------- |
| No `import defer`         | 35.8 ms | 0 ms                      |
| `import defer`, no PIFE   | 22.1 ms | 28.8 ms                   |
| `import defer`, with PIFE | 21.0 ms | 20.6 ms                   |

### Reads after evaluation

`repro/steady-state` reads a member of a deferred namespace in a loop, after the module is evaluated. One read took 1.4 ns with Rolldown, 10.2 ns with webpack and 9.5 ns with Rspack 2.3.1 (best of 7 runs, `results/steady-state.txt`). This run was on 2026-11-05, with an early build of the branch. A run with `1b6a25326` on 2026-11-12 gave 1.5 ns, 10.4 ns and 9.5 ns.

## Builds

The sha1 column has the first 12 characters of the SHA-1 of each bundle, as in `results/builds-*.json`. The run used local builds. A build at each commit below gives a bundle with the same sha1.

| Build                       | Source                     | Variant         | sha1           |
| --------------------------- | -------------------------- | --------------- | -------------- |
| Rolldown, no `import defer` | rolldown `1b6a25326`       | `eager`         | `d13b28831ef0` |
| Rolldown + `import defer`   | rolldown `1b6a25326`       | `defer`         | `d668397ab24e` |
| `import defer`, no PIFE     | rolldown `3fe730b4a`       | `defer`         | `6a0482bbe7c5` |
| `import defer`, with PIFE   | rolldown `3fe730b4a`       | `defer-pife`    | `87de2c2c5a6b` |
| webpack, no `import defer`  | `tools/`, webpack 5.112.2  | `webpack-eager` | `7b2d75bb15f0` |
| webpack + `import defer`    | `tools/`, webpack 5.112.2  | `webpack-defer` | `699a9a2a34bc` |

Both rolldown commits are on the branch [`feat/import-defer-pife`](https://github.com/rolldown/rolldown/tree/feat/import-defer-pife) of rolldown/rolldown.

## Raw data

`results/` has the raw data of the run:

- `timing-node-final-table-fixed.json` and `timing-workerd-ready-final-table-fixed.json`: the medians and quantiles of each config.
- `builds-*.json`: the size, the sha1 and the module list of each bundle.

Each key names the folder of a bundle:

- `dist-p1:eager`: Rolldown, no `import defer`.
- `dist-fixed:defer`: Rolldown + `import defer`.
- `dist-3fe730b4a:defer`: `import defer`, no PIFE.
- `dist-p1:defer`: `import defer`, with PIFE. It is the same bundle as `defer-pife` of `3fe730b4a`.
- `webpack-eager` and `webpack-defer`: webpack.
- The other keys are builds of intermediate states of the branch. These states are not commits.

## Run the bench

1. Install the packages of the app, and webpack and Rspack in `tools/`:

   ```sh
   npm ci
   npm ci --prefix tools
   ```

2. Build rolldown at the commit. First set up the tools as in [Setup the project](https://rolldown.rs/development-guide/setup-the-project). A debug build is enough, because the build profile does not change the output.

   ```sh
   git clone https://github.com/rolldown/rolldown.git ../rolldown
   git -C ../rolldown checkout 1b6a25326
   (cd ../rolldown && just build-rolldown)
   export ROLLDOWN_DIST=../rolldown/packages/rolldown/dist
   ```

3. Build the bundles, and check that all bundles give the same responses:

   ```sh
   node scripts/build.mjs                 # dist/<variant>/worker.mjs, results/builds.json
   node scripts/build-others.mjs webpack  # dist/webpack-<variant>/worker.mjs, results/builds-others.json
   node scripts/smoke.mjs eager defer webpack-eager webpack-defer
   ```

4. Measure the startup and the first use in Node.js:

   ```sh
   C=eager/startup,eager/all,defer/startup,defer/all
   C=$C,webpack-eager/startup,webpack-eager/all,webpack-defer/startup,webpack-defer/all
   for r in ai graphql s3 ssr; do C=$C,defer/$r,webpack-defer/$r; done
   node scripts/time.mjs --rounds 30 --warmup 2 --configs "$C" --out results/timing-node.json
   ```

   For `<variant>/startup`, `totalMs` is the startup. For `<variant>/<route>` and `<variant>/all`, `touchMs` is the first use, and `allMs` is the startup plus the first use.

5. Measure the startup in workerd. Subtract the median of the `empty` config from each value.

   ```sh
   node scripts/workerd-ready.mjs 30 eager,defer,webpack-eager,webpack-defer results/timing-workerd.json
   ```

6. For the PIFE table, build rolldown at `3fe730b4a`, then:

   ```sh
   BENCH_DIST=dist-3fe730b4a BENCH_VARIANTS=defer,defer-pife node scripts/build.mjs
   C=dist-3fe730b4a:defer/startup,dist-3fe730b4a:defer/all
   C=$C,dist-3fe730b4a:defer-pife/startup,dist-3fe730b4a:defer-pife/all
   node scripts/time.mjs --rounds 30 --warmup 2 --configs "$C" --out results/timing-node-pife.json
   ```

7. For the reads after evaluation:

   ```sh
   node repro/steady-state/build.mjs
   for t in rolldown webpack rspack; do echo "$t $(node repro/steady-state/run.mjs repro/steady-state/out/$t.mjs)"; done
   ```

   `runStatic` is the read through the deferred namespace, and `runEager` is the same read through an eager namespace.

The timings change with the load of the machine. Close other programs, and compare medians, not means.
