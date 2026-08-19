import { describe, it, expect, afterEach } from 'bun:test';
import { getRoxClientId, startRoxDeviceFlow } from '../rox-cloud';

const ORIGINAL_ENV = process.env.ROX_CLIENT_ID;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.ROX_CLIENT_ID;
  } else {
    process.env.ROX_CLIENT_ID = ORIGINAL_ENV;
  }
});

describe('getRoxClientId', () => {
  it('defaults to craft-agents-desktop when ROX_CLIENT_ID is unset', () => {
    delete process.env.ROX_CLIENT_ID;
    expect(getRoxClientId()).toBe('craft-agents-desktop');
  });

  it('uses ROX_CLIENT_ID when set', () => {
    process.env.ROX_CLIENT_ID = 'rox-desktop';
    expect(getRoxClientId()).toBe('rox-desktop');
  });

  it('falls back to the default when ROX_CLIENT_ID is empty or whitespace', () => {
    process.env.ROX_CLIENT_ID = '   ';
    expect(getRoxClientId()).toBe('craft-agents-desktop');
  });
});

describe('startRoxDeviceFlow', () => {
  it('sends the env-derived clientId to the device start endpoint', async () => {
    process.env.ROX_CLIENT_ID = 'rox-desktop';
    process.env.ROX_AUTH_BASE_URL = 'https://auth.example.test';

    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(
        JSON.stringify({
          device_code: 'dc',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.test/device',
          verification_uri_complete: 'https://auth.example.test/device?code=ABCD-EFGH',
          expires_in: 600,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await startRoxDeviceFlow();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toBe('https://auth.example.test/api/auth/device/start');
      expect(calls[0]!.body).toEqual({ clientId: 'rox-desktop' });
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ROX_AUTH_BASE_URL;
    }
  });

  it('an explicit clientId argument still wins over the env var', async () => {
    process.env.ROX_CLIENT_ID = 'rox-desktop';
    process.env.ROX_AUTH_BASE_URL = 'https://auth.example.test';

    const bodies: unknown[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(
        JSON.stringify({
          device_code: 'dc',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.test/device',
          verification_uri_complete: 'https://auth.example.test/device?code=ABCD-EFGH',
          expires_in: 600,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      await startRoxDeviceFlow('explicit-client');
      expect(bodies).toEqual([{ clientId: 'explicit-client' }]);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.ROX_AUTH_BASE_URL;
    }
  });
});
