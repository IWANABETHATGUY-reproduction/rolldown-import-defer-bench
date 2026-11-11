// a. React SSR with the edge build of react-dom/server (resolved via the "workerd" condition)
import { createElement as h, Suspense } from 'react';
import { renderToReadableStream } from 'react-dom/server';

function Item({ i }) {
  return h('li', { className: i % 2 ? 'odd' : 'even' }, `Item #${i}`);
}
function Layout({ title, children }) {
  return h('html', { lang: 'en' },
    h('head', null, h('meta', { charSet: 'utf-8' }), h('title', null, title)),
    h('body', null, h('header', null, h('h1', null, title)), h('main', null, children), h('footer', null, 'Rendered on Workers')));
}
function App({ items }) {
  return h(Layout, { title: 'React SSR on Workers' },
    h(Suspense, { fallback: h('p', null, 'Loading...') },
      h('ul', null, items.map((i) => h(Item, { key: i, i })))));
}

export default {
  async fetch(request) {
    const n = Number(new URL(request.url).searchParams.get('n') ?? 20);
    const stream = await renderToReadableStream(h(App, { items: Array.from({ length: n }, (_, i) => i) }));
    return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};
