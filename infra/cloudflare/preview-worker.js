const ORIGIN_SUFFIX = 'daytonaproxy01.net';
const RESERVED = new Set([2280, 2281, 22220, 33333]);
const DOWN = 'Сайт временно недоступен. Попробуйте ещё раз через минуту.';

function down() {
  return new Response(DOWN, {
    status: 502,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    // One stable host keeps Universal SSL working: the signed label and port
    // travel in the first path segment, not in a second-level subdomain.
    const match = /^\/(\d{1,5}-[a-z0-9]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return new Response('Not found', { status: 404 });
    const label = match[1];
    if (RESERVED.has(Number(label.split('-')[0]))) {
      return new Response('Not found', { status: 404 });
    }

    const target = new URL(request.url);
    target.protocol = 'https:';
    target.hostname = `${label}.${ORIGIN_SUFFIX}`;
    target.pathname = match[2] || '/';
    const headers = new Headers(request.headers);
    headers.delete('host');
    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual',
      });
      if (upstream.status >= 500) return down();
      if (upstream.status >= 400) {
        const type = upstream.headers.get('content-type') || '';
        if (type.includes('json') || type.includes('html')) {
          const text = await upstream.text();
          if (/daytona/i.test(text)) return down();
          return new Response(text, { status: upstream.status, headers: upstream.headers });
        }
      }
      return upstream;
    } catch {
      return down();
    }
  },
};
