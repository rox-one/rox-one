import { describe, expect, it } from 'bun:test';
import type { HttpFetch } from '../http-fetch.ts';
import { SessionApplyClient } from './client.ts';
import { SessionApplyFlagOffError, SessionApplyHttpError, DEFAULT_OPERATOR_ORIGIN } from './types.ts';

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

  it('treats 204 as success without a JSON body', async () => {
    const fetch: HttpFetch = async () => new Response(null, { status: 204 });
    const client = new SessionApplyClient({ flagEnabled: true, fetch });
    const result = await client.read();
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
  });

  for (const status of [401, 403, 404, 429, 500, 503]) {
    it(`throws SessionApplyHttpError on ${status} without leaking the body`, async () => {
      const fetch: HttpFetch = async () =>
        new Response(JSON.stringify({ token: 'super-secret', error: 'nope' }), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      const client = new SessionApplyClient({
        flagEnabled: true,
        origin: 'https://conation.dev',
        fetch,
      });
      await expect(client.read()).rejects.toMatchObject({
        name: 'SessionApplyHttpError',
        status,
        origin: 'https://conation.dev',
      });
      try {
        await client.apply({ workspaceRoot: '/ws', teamId: 'alpha' });
        throw new Error('expected apply to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(SessionApplyHttpError);
        expect(String(error)).not.toContain('super-secret');
        expect(JSON.stringify(error)).not.toContain('super-secret');
      }
    });
  }
});
