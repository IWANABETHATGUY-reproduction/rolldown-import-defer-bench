// Composite Worker: an eager core API (Hono + zod + drizzle) and four heavy routes.
// scripts/build.mjs writes main.eager.js (__PHASE__ = '') and main.defer.js (__PHASE__ = 'defer ').
import { Hono } from 'hono';
import todos from './routes/todos.js';
import __PHASE__* as ai from './routes/ai.js';
import __PHASE__* as graphql from './routes/graphql.js';
import __PHASE__* as ssr from './routes/ssr.js';
import __PHASE__* as s3 from './routes/s3.js';

const app = new Hono();
app.get('/', (c) => c.text('ok'));
app.route('/', todos);
app.post('/ai', (c) => ai.default.fetch(c.req.raw, c.env));
app.on(['GET', 'POST'], '/graphql', (c) => graphql.default.fetch(c.req.raw, c.env, {}));
app.get('/ssr', (c) => ssr.default.fetch(c.req.raw));
app.on(['GET', 'PUT'], '/s3/*', (c) => s3.default.fetch(c.req.raw, c.env));

// Measurement hook: reads `default` of one route namespace (or of all), with static member
// accesses only. With `import defer`, the first read evaluates the module and its dependencies.
export function __touch(name) {
  switch (name) {
    case 'ai': return typeof ai.default;
    case 'graphql': return typeof graphql.default;
    case 'ssr': return typeof ssr.default;
    case 's3': return typeof s3.default;
    case 'all': return [typeof ai.default, typeof graphql.default, typeof ssr.default, typeof s3.default].join();
    default: return 'none';
  }
}

export default app;
