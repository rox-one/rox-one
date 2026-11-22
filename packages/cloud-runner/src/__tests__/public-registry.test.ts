/**
 * Explicit provider resolution — no silent fallback.
 *
 * A stale config value (`modal` was retired with Cloudflare/E2B) must be
 * visible to the caller, because falling back to `daytona` would bill the
 * wrong account. Empty stays on the historical default.
 */
import { describe, expect, test } from 'bun:test';
import {
  PUBLIC_CLOUD_RUN_PROVIDERS,
  coercePublicCloudRunProvider,
  resolvePublicCloudRunProvider,
} from '../public-registry.ts';
import { CloudRunnerError } from '../types.ts';

describe('resolvePublicCloudRunProvider', () => {
  test('empty and undefined default to daytona', () => {
    expect(resolvePublicCloudRunProvider(undefined)).toEqual({ ok: true, provider: 'daytona' });
    expect(resolvePublicCloudRunProvider('')).toEqual({ ok: true, provider: 'daytona' });
  });

  test('every public provider name resolves to itself', () => {
    for (const name of PUBLIC_CLOUD_RUN_PROVIDERS) {
      expect(resolvePublicCloudRunProvider(name)).toEqual({ ok: true, provider: name });
    }
  });

  test('a stale provider name is rejected with the allowed list', () => {
    const result = resolvePublicCloudRunProvider('modal');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('modal must not resolve to a provider');
    expect(result.error).toBe('provider_unknown');
    expect(result.allowed).toBe(PUBLIC_CLOUD_RUN_PROVIDERS);
    expect([...result.allowed]).toEqual(['daytona', 'local', 'native']);
  });
});

describe('coercePublicCloudRunProvider', () => {
  test('keeps the historical default for an empty value', () => {
    expect(coercePublicCloudRunProvider(undefined)).toBe('daytona');
    expect(coercePublicCloudRunProvider('')).toBe('daytona');
  });

  test('returns each public name unchanged', () => {
    for (const name of PUBLIC_CLOUD_RUN_PROVIDERS) {
      expect(coercePublicCloudRunProvider(name)).toBe(name);
    }
  });

  test('throws CloudRunnerError provider_unknown for a stale name', () => {
    expect(() => coercePublicCloudRunProvider('modal')).toThrow(CloudRunnerError);
    let caught: unknown;
    try {
      coercePublicCloudRunProvider('modal');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CloudRunnerError);
    const err = caught as CloudRunnerError;
    expect(err.code).toBe('provider_unknown');
    expect(err.message).toContain('modal');
    expect(err.message).toContain('daytona, local, native');
  });
});
