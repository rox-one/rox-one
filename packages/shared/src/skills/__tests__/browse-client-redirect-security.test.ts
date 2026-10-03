import { describe, expect, test } from 'bun:test';
import { BrowseClient as FlatBrowseClient } from '../../../../../apps/electron/resources/skills/gstack/browse/src/browse-client';
import { BrowseClient as NestedBrowseClient } from '../../../../../apps/electron/resources/skills/gstack/gstack/browse/src/browse-client';
import { BrowseClient as PortableBrowseClient } from '../../../../../apps/electron/resources/skills/gstack/gstack/browser-skills/hackernews-frontpage/_lib/browse-client';

const clients = [
  ['flat canonical', FlatBrowseClient],
  ['nested canonical', NestedBrowseClient],
  ['portable Hacker News', PortableBrowseClient],
] as const;

for (const [name, Client] of clients) {
  describe(`${name} daemon redirect boundary`, () => {
    test('normal commands preserve bearer authentication, arguments and tab scope', async () => {
      const received: unknown[] = [];
      const daemon = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
        received.push({
          path: new URL(request.url).pathname,
          method: request.method,
          authorization: request.headers.get('authorization'),
          body: await request.json(),
        });
        return new Response('command accepted');
      } });
      try {
        const client = new Client({ port: daemon.port, token: 'synthetic-test-capability', tabId: 7 });
        expect(await client.command('fill', ['#field', 'synthetic private input'])).toBe('command accepted');
        expect(received).toEqual([{
          path: '/command', method: 'POST', authorization: 'Bearer synthetic-test-capability',
          body: { command: 'fill', args: ['#field', 'synthetic private input'], tabId: 7 },
        }]);
      } finally { daemon.stop(true); }
    });

    for (const status of [307, 308]) {
      for (const destination of ['same origin', 'another port']) {
        test(`rejects HTTP ${status} to ${destination} without forwarding command contents`, async () => {
          const forwarded: unknown[] = [];
          const target = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
            forwarded.push({ authorization: request.headers.get('authorization'), body: await request.text() });
            return new Response('redirect destination received the command');
          } });
          const daemon = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
            if (new URL(request.url).pathname !== '/command') {
              forwarded.push({ authorization: request.headers.get('authorization'), body: await request.text() });
              return new Response('same-origin redirect received the command');
            }
            await request.text();
            return new Response('command redirects are forbidden', {
              status,
              headers: { location: destination === 'same origin' ? '/forwarded' : `http://127.0.0.1:${target.port}/forwarded` },
            });
          } });
          try {
            const client = new Client({ port: daemon.port, token: 'synthetic-test-capability', tabId: 7 });
            const result = await client.command('fill', ['#field', 'synthetic private input']).catch(error => error);
            expect(forwarded).toEqual([]);
            expect(result).toBeInstanceOf(Error);
            expect(result.name).toBe('BrowseClientError');
            expect(result.status).toBe(status);
            expect(result.body).toBe('command redirects are forbidden');
          } finally { daemon.stop(true); target.stop(true); }
        });
      }
    }
  });
}
