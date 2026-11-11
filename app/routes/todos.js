// Core API (eager in both variants): Hono + zod + drizzle-orm (D1), as a sub-app.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { eq, desc } from 'drizzle-orm';

const todos = sqliteTable('todos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

const NewTodo = z.object({ title: z.string().min(1).max(200), done: z.boolean().default(false) });
const IdParam = z.coerce.number().int().positive();

const app = new Hono();
app.use('/api/*', cors());

app.get('/api/todos', async (c) => {
  const db = drizzle(c.env.DB);
  return c.json(await db.select().from(todos).orderBy(desc(todos.createdAt)).limit(50));
});
app.get('/api/todos/:id', async (c) => {
  const id = IdParam.parse(c.req.param('id'));
  const [row] = await drizzle(c.env.DB).select().from(todos).where(eq(todos.id, id));
  if (!row) throw new HTTPException(404, { message: 'not found' });
  return c.json(row);
});
app.post('/api/todos', async (c) => {
  const parsed = NewTodo.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ issues: parsed.error.issues }, 400);
  const [row] = await drizzle(c.env.DB).insert(todos).values({ ...parsed.data, createdAt: new Date() }).returning();
  return c.json(row, 201);
});
app.onError((err, c) => (err instanceof HTTPException ? err.getResponse() : c.json({ error: 'internal' }, 500)));

export default app;
