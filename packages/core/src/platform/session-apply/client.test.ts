import { describe, expect, it } from 'bun:test';
import type { HttpFetch } from '../http-fetch.ts';
import { SessionApplyClient } from './client.ts';
import { SessionApplyFlagOffError, DEFAULT_OPERATOR_ORIGIN } from './types.ts';

describe('SessionApplyClient', () => {
  it('fails closed without calling fetch when flag is off', async () => {
    let calls = 0;
    const fetch: HttpFetch = async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    };
    const client = new SessionApplyClient({ flagEnabled: false, fetch });
    await expect(client.read()).rejects.toBeInstanceOf(SessionApplyFlagOffError);
    await expect(client.apply({ workspaceRoot: '/tmp/ws' })).rejects.toBeInstanceOf(
      SessionApplyFlagOffError,
    );
    expect(calls).toBe(0);
  });

  it('GETs operator origin read path when flag is on', async () => {
    const urls: string[] = [];
    const fetch: HttpFetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ stub: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new SessionApplyClient({ flagEnabled: true, fetch });
    const result = await client.read();
    expect(result.origin).toBe(DEFAULT_OPERATOR_ORIGIN);
    expect(result.status).toBe(200);
    expect(urls[0]).toBe('https://conation.dev/session-apply');
  });

  it('POSTs apply and returns a pointer', async () => {
    const fetch: HttpFetch = async () =>
      new Response(JSON.stringify({ applied: true }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    const client = new SessionApplyClient({
      flagEnabled: true,
      origin: 'https://conation.dev/',
      fetch,
    });
    const result = await client.apply({ workspaceRoot: '/ws', teamId: 'alpha' });
    expect(result.status).toBe(202);
    expect(result.pointer).toContain('https://conation.dev/session-apply');
    expect(result.pointer).toContain('team=alpha');
  });
});
