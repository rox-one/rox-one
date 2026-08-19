/**
 * Environment Secret Provider
 *
 * Resolves secrets from process environment variables, gated by an allowlist
 * of prefixes (default `ROX_SECRET_`). The allowlist is the security boundary:
 * arbitrary process env (ANTHROPIC_API_KEY, AWS_*, …) must NOT be reachable
 * through secret refs — only variables explicitly staged for injection.
 *
 * This covers the runtime-injection use case of the disabled credentials
 * EnvironmentBackend (which stays untouched).
 */

import type { SecretProvider, SecretRef } from '../types.ts';

export const DEFAULT_ENV_PREFIXES = ['ROX_SECRET_'] as const;

/** Derive the default env var name for a logical secret name: `my-api-key` → `ROX_SECRET_MY_API_KEY`. */
export function defaultEnvironmentRefFor(name: string): string {
  return 'ROX_SECRET_' + name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export interface EnvironmentProviderOptions {
  /** Allowlist prefixes; a ref must start with one of them. Default: ['ROX_SECRET_']. */
  prefixes?: readonly string[];
  /** Env to read from (tests). Default: process.env. */
  env?: Record<string, string | undefined>;
}

export class EnvironmentProvider implements SecretProvider {
  readonly id = 'environment' as const;

  private readonly prefixes: readonly string[];
  private readonly env: Record<string, string | undefined>;

  constructor(options: EnvironmentProviderOptions = {}) {
    this.prefixes = options.prefixes ?? DEFAULT_ENV_PREFIXES;
    this.env = options.env ?? process.env;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private isAllowed(variable: string): boolean {
    return this.prefixes.some((prefix) => variable.startsWith(prefix));
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    const variable = ref.ref ?? defaultEnvironmentRefFor(ref.name);
    if (!this.isAllowed(variable)) {
      return null;
    }
    return this.env[variable] ?? null;
  }

  async list(): Promise<SecretRef[]> {
    return Object.keys(this.env)
      .filter((key) => this.isAllowed(key) && this.env[key] !== undefined)
      .map((key) => ({ name: key, ref: key }));
  }
}
