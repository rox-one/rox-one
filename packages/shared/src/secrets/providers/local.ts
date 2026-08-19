/**
 * Local Encrypted Secret Provider
 *
 * Adapts the existing CredentialManager (AES-256-GCM file backend,
 * ~/.craft-agent/credentials.enc) to the SecretProvider interface.
 * No crypto is reimplemented here — refs map to credential account strings.
 *
 * Default ref derivation: `service_oauth::global::<name>` — the same generic
 * workspace-scoped slot the Rox cloud session uses, suitable for arbitrary
 * user-stashed secrets. Explicit refs may name any valid credential account
 * (e.g. `llm_api_key::my-connection`).
 */

import {
  accountToCredentialId,
  credentialIdToAccount,
  type CredentialId,
  type StoredCredential,
} from '../../credentials/types.ts';
import { getCredentialManager } from '../../credentials/manager.ts';
import type { SecretProvider, SecretRef } from '../types.ts';

/** Default credential account for a logical secret name. */
export function defaultLocalRefFor(name: string): string {
  return `service_oauth::global::${name}`;
}

/** Minimal surface this provider needs (injectable for tests). */
export interface LocalCredentialStore {
  get(id: CredentialId): Promise<StoredCredential | null>;
  list?(filter?: Partial<CredentialId>): Promise<CredentialId[]>;
}

export interface LocalEncryptedProviderOptions {
  manager?: LocalCredentialStore;
}

export class LocalEncryptedProvider implements SecretProvider {
  readonly id = 'local-encrypted' as const;

  private readonly manager: LocalCredentialStore;

  constructor(options: LocalEncryptedProviderOptions = {}) {
    this.manager = options.manager ?? getCredentialManager();
  }

  async isAvailable(): Promise<boolean> {
    // SecureStorageBackend is always available (see CredentialManager).
    return true;
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    const account = ref.ref ?? defaultLocalRefFor(ref.name);
    const id = accountToCredentialId(account);
    if (!id) {
      return null;
    }
    try {
      const cred = await this.manager.get(id);
      return cred?.value ?? null;
    } catch {
      // A corrupted/undecryptable store must not break spawn — treat as not found.
      return null;
    }
  }

  async list(): Promise<SecretRef[]> {
    if (!this.manager.list) return [];
    try {
      const ids = await this.manager.list({});
      return ids.map((id) => {
        const account = credentialIdToAccount(id);
        return { name: account, ref: account };
      });
    } catch {
      return [];
    }
  }
}
