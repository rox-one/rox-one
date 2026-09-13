import { describe, expect, it } from 'bun:test';
import type { HttpFetch } from '../http-fetch.ts';
import { SessionApplyClient } from './client.ts';
import {
  SessionApplyFlagOffError,
  SessionApplyHttpError,
  DEFAULT_OPERATOR_ORIGIN,
} from './types.ts';

const SECRET_BODY = { token: 'sk-live-secret', detail: 'internal stack' };

function jsonResponse(status: number, body: unknown = SECRET_BODY): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function assertRedacted(error: SessionApplyHttpError): void {
  const blob = `${error.message}\n${error.name}\n${error.stack ?? ''}\n${JSON.stringify(error)}`;
  expect(blob).not.toContain('sk-live-secret');
  expect(blob).not.toContain('internal stack');
  expect(error.message).toBe(`SessionApply HTTP ${error.status}`);
}

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
    expect(result.ok).toBe(true);
    expect(urls[0]).toBe('https://conation.dev/session-apply');
  });

  it('POSTs apply and returns a pointer for 202 accepted transport', async () => {
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
    expect(result.ok).toBe(true);
    expect(result.transportAccepted).toBe(true);
    expect(result.businessCompleted).toBe(false);
    expect(result.pointer).toContain('https://conation.dev/session-apply');
    expect(result.pointer).toContain('team=alpha');
  });

  it('treats HTTP 200 as transport accepted and business completed', async () => {
    const fetch: HttpFetch = async () =>
      new Response(JSON.stringify({ stub: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const client = new SessionApplyClient({ flagEnabled: true, fetch });
    const read = await client.read();
    expect(read.ok).toBe(true);
    expect(read.transportAccepted).toBe(true);
    expect(read.businessCompleted).toBe(true);
    const apply = await client.apply({ workspaceRoot: '/ws' });
    expect(apply.ok).toBe(true);
    expect(apply.transportAccepted).toBe(true);
    expect(apply.businessCompleted).toBe(true);
  });

  it('treats 204 as transport success with a null body', async () => {
    const fetch: HttpFetch = async () => new Response(null, { status: 204 });
    const client = new SessionApplyClient({ flagEnabled: true, fetch });
    const read = await client.read();
    expect(read.status).toBe(204);
    expect(read.body).toBeNull();
    expect(read.transportAccepted).toBe(true);
    expect(read.businessCompleted).toBe(true);
    const apply = await client.apply({ workspaceRoot: '/ws' });
    expect(apply.status).toBe(204);
    expect(apply.body).toBeNull();
    expect(apply.transportAccepted).toBe(true);
    expect(apply.businessCompleted).toBe(true);
  });

  for (const status of [401, 403, 404, 429, 500, 503] as const) {
    it(`throws SessionApplyHttpError on ${status} without parsing the body`, async () => {
      let cancelled = 0;
      const fetch: HttpFetch = async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(SECRET_BODY)));
            controller.close();
          },
          cancel() {
            cancelled += 1;
          },
        });
        return new Response(stream, {
          status,
          headers: { 'content-type': 'application/json' },
        });
      };
      const client = new SessionApplyClient({ flagEnabled: true, fetch });
      const readError = await client.read().catch((err: unknown) => err);
      expect(readError).toBeInstanceOf(SessionApplyHttpError);
      expect((readError as SessionApplyHttpError).status).toBe(status);
      expect((readError as SessionApplyHttpError).method).toBe('GET');
      assertRedacted(readError as SessionApplyHttpError);

      const applyError = await client.apply({ workspaceRoot: '/ws' }).catch((err: unknown) => err);
      expect(applyError).toBeInstanceOf(SessionApplyHttpError);
      expect((applyError as SessionApplyHttpError).status).toBe(status);
      expect((applyError as SessionApplyHttpError).method).toBe('POST');
      expect(applyError).not.toHaveProperty('ok');
      expect(applyError).not.toHaveProperty('transportAccepted');
      expect(applyError).not.toHaveProperty('businessCompleted');
      assertRedacted(applyError as SessionApplyHttpError);
      expect(cancelled).toBe(2);
    });
  }

  it('still throws HTTP error when body cancel fails', async () => {
    const fetch: HttpFetch = async () => {
      const response = jsonResponse(500);
      Object.defineProperty(response, 'body', {
        value: {
          cancel: async () => {
            throw new Error('cancel exploded');
          },
        },
      });
      return response;
    };
    const client = new SessionApplyClient({ flagEnabled: true, fetch });
    const error = await client.read().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SessionApplyHttpError);
    expect((error as SessionApplyHttpError).status).toBe(500);
    assertRedacted(error as SessionApplyHttpError);
  });
});
