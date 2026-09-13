import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { SessionApplyClient } from './client.ts';
import { SessionApplyFlagOffError } from './types.ts';

for (const method of ['read', 'apply'] as const) {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    test(`${method}: HTTP ${status} rejects, never reports success`, async () => {
      let parsed = 0;
      let cancelled = 0;
      const response = {
        ok: false, status, statusText: 'secret-status',
        body: { cancel: async () => { cancelled++; } },
        json: async () => { parsed++; return { secret: 'sensitive-body' }; },
      } as unknown as Response;
      const client = new SessionApplyClient({ flagEnabled: true, fetch: async () => response });
      await assert.rejects(
        () => method === 'read' ? client.read() : client.apply({ workspaceRoot: '/fixture', teamId: 't' }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          const e = error as Error & { code: string; status: number; method: string };
          assert.equal(e.name, 'SessionApplyHttpError');
          assert.equal(e.code, 'SESSION_APPLY_HTTP_ERROR');
          assert.equal(e.status, status);
          assert.equal(e.method, method === 'read' ? 'GET' : 'POST');
          assert.ok(!e.message.includes('secret'));
          return true;
        },
      );
      assert.equal(parsed, 0, 'Error response body must not be parsed or returned');
      assert.equal(cancelled, 1, 'Dispose unread response stream');
    });
  }
  for (const status of [200, 202, 204]) {
    test(`${method}: accepts HTTP ${status} transport result`, async () => {
      const client = new SessionApplyClient({
        flagEnabled: true,
        fetch: async () => new Response(status === 204 ? null : '{"accepted":true}', { status }),
      });
      const result = await (method === 'read' ? client.read() : client.apply({ workspaceRoot: '/fixture', teamId: 't' }));
      assert.equal(result.status, status);
      assert.equal(result.ok, true);
      if (status === 204) assert.equal(result.body, null);
    });
  }
}

test('flag off does not fetch', async () => {
  let calls = 0;
  const client = new SessionApplyClient({ flagEnabled: false, fetch: async () => { calls++; return new Response('{}'); } });
  await assert.rejects(() => client.read(), SessionApplyFlagOffError);
  await assert.rejects(() => client.apply({ workspaceRoot: '/x' }), SessionApplyFlagOffError);
  assert.equal(calls, 0);
});

test('transport rejection propagates', async () => {
  const error = new Error('network unavailable');
  const client = new SessionApplyClient({ flagEnabled: true, fetch: async () => { throw error; } });
  await assert.rejects(() => client.read(), e => e === error);
});

test('body cancellation failure cannot mask HTTP error', async () => {
  const response = { ok: false, status: 502, body: { cancel: async () => { throw Error('private'); } } } as unknown as Response;
  const client = new SessionApplyClient({ flagEnabled: true, fetch: async () => response });
  await assert.rejects(() => client.read(), (error: unknown) => {
    assert.ok(error instanceof Error);
    return error.name === 'SessionApplyHttpError' && (error as Error & { status: number }).status === 502;
  });
});
