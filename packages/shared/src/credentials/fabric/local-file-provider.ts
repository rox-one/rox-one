import {
  CredentialRefRegistry,
  isCredentialRefId,
  type CredentialKind,
  type CredentialRef,
  type ProviderLocator,
} from '@rox/core/platform';
import type { CredentialBackend } from '../backends/types.ts';
import type { CredentialId, StoredCredential } from '../types.ts';
import { credentialPayloadFingerprint } from '../envelope.ts';
import { createProviderMaterialization } from './materialization.ts';
import type { ProviderCredentialMetadata, ProviderMaterialization, SecretProvider } from './types.ts';

export class LocalFileSecretProvider implements SecretProvider {
  readonly id = 'local-file';
  private readonly copies = new Map<string, {
    id: CredentialId;
    payload: StoredCredential;
    kind: CredentialKind;
    backend: CredentialBackend;
  }>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly byConflict = new Map<string, CredentialRef>();

  constructor(
    private readonly backend: CredentialBackend,
    private readonly registry: CredentialRefRegistry,
  ) {}

  async health(): Promise<{ status: 'healthy' | 'repair_required' | 'unavailable' }> {
    try {
      if (!(await this.backend.isAvailable())) return { status: 'unavailable' };
      return { status: 'healthy' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  async write(input: {
    kind: CredentialKind;
    locator: ProviderLocator;
    payload: StoredCredential;
    copyPayload?: boolean;
    expiresAt?: number;
  }): Promise<{ ref: CredentialRef; version: import('@rox/core/platform').CredentialVersion }> {
    const conflictKey = input.locator.type === 'local' ? input.locator.key : JSON.stringify(input.locator);
    const fingerprint = credentialPayloadFingerprint(input.kind, input.payload);
    const existing = this.byConflict.get(`${conflictKey}:${fingerprint}`);
    if (existing) {
      const version = this.registry.listVersions(existing.id)[0];
      if (version) return { ref: existing, version };
    }
    const ref = this.registry.register({
      kind: input.kind,
      providerId: this.id,
      locator: input.locator,
    });
    const version = this.registry.registerVersion({
      credentialRefId: ref.id,
      codec: 'stored-credential/v1',
      fingerprint,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    });
    if (input.copyPayload !== false) {
      const id: CredentialId = { type: 'source_apikey', workspaceId: 'fabric', sourceId: ref.id };
      await this.backend.set(id, input.payload);
      this.copies.set(ref.id, { id, payload: input.payload, kind: input.kind, backend: this.backend });
    }
    this.byConflict.set(`${conflictKey}:${fingerprint}`, ref);
    return { ref, version };
  }

  async inspect(ref: CredentialRef): Promise<ProviderCredentialMetadata> {
    const copy = this.copies.get(ref.id);
    const versions = this.registry.listVersions(ref.id);
    const current = versions.find((version) => version.status === 'active') ?? versions[0];
    if (!copy) {
      return {
        credentialRefId: ref.id,
        kind: ref.kind,
        fingerprint: current?.fingerprint ?? '',
        status: 'missing',
        backend: undefined,
        expiresAt: current?.expiresAt ?? null,
        versionId: current?.id,
      };
    }
    return {
      credentialRefId: ref.id,
      kind: copy.kind,
      fingerprint: credentialPayloadFingerprint(copy.kind, copy.payload),
      status: 'active',
      backend: copy.backend.name,
      expiresAt: current?.expiresAt ?? null,
      versionId: current?.id,
    };
  }

  async dropCopy(ref: CredentialRef): Promise<void> {
    return this.withCredentialMutation(ref.id, () => this.dropCopyNow(ref));
  }

  private async dropCopyNow(ref: CredentialRef): Promise<void> {
    const copy = this.copies.get(ref.id);
    if (!copy) return;
    await copy.backend.delete(copy.id);
    if (await copy.backend.get(copy.id)) throw new Error('copy_delete_failed');
    this.copies.delete(ref.id);
  }

  async resolveForLease(input: { credentialRef: CredentialRef }): Promise<ProviderMaterialization> {
    if (this.mutations.has(input.credentialRef.id)) throw new Error('credential_mutation_in_progress');
    const copy = this.copies.get(input.credentialRef.id);
    if (!copy) throw new Error('Provider materialization missing');
    return createProviderMaterialization(input.credentialRef.id, copy.kind, copy.payload);
  }

  private async withCredentialMutation<T>(refId: string, operation: () => Promise<T>, rejectIfBusy = false): Promise<T> {
    const previous = this.mutations.get(refId);
    if (rejectIfBusy && previous) throw new Error('move_in_progress');
    let finish!: () => void;
    const current = new Promise<void>(resolve => { finish = resolve; });
    this.mutations.set(refId, current);
    try {
      await previous;
      return await operation();
    } finally {
      if (this.mutations.get(refId) === current) this.mutations.delete(refId);
      finish();
    }
  }

  async moveCopy(ref: CredentialRef, target: CredentialBackend): Promise<{ from: string; to: string }> {
    return this.withCredentialMutation(ref.id, () => this.moveCopyNow(ref, target), true);
  }

  private async moveCopyNow(
    ref: CredentialRef,
    target: CredentialBackend,
  ): Promise<{ from: string; to: string }> {
    const copy = this.copies.get(ref.id);
    if (!copy) throw new Error('move_unavailable');
    if (copy.backend.name === target.name) throw new Error('same_backend');
    if (!(await target.isAvailable())) throw new Error('backend_unavailable');
    if (await target.get(copy.id)) throw new Error('target_copy_exists');
    let sourceDeleted = false;
    try {
      await target.set(copy.id, copy.payload);
      const readback = await target.get(copy.id);
      if (!readback || credentialPayloadFingerprint(copy.kind, readback)
        !== credentialPayloadFingerprint(copy.kind, copy.payload)) throw new Error('move_verification_failed');
      sourceDeleted = await copy.backend.delete(copy.id);
      if (!sourceDeleted || await copy.backend.get(copy.id)) throw new Error('move_source_delete_failed');
    } catch {
      // Restore the source before removing the verified destination if deletion was partial.
      try {
        if (sourceDeleted || !(await copy.backend.get(copy.id))) await copy.backend.set(copy.id, copy.payload);
        const restored = await copy.backend.get(copy.id);
        if (!restored || credentialPayloadFingerprint(copy.kind, restored)
          !== credentialPayloadFingerprint(copy.kind, copy.payload)) throw new Error('source_restore_failed');
        await target.delete(copy.id);
        if (await target.get(copy.id)) throw new Error('target_cleanup_failed');
      } catch {
        throw new Error('move_rollback_failed');
      }
      throw new Error('move_failed');
    }
    this.copies.set(ref.id, { ...copy, backend: target });
    return { from: copy.backend.name, to: target.name };
  }

  async revoke(input: { credentialRef: CredentialRef }): Promise<void> {
    return this.withCredentialMutation(input.credentialRef.id, () => this.revokeNow(input));
  }

  private async revokeNow(input: { credentialRef: CredentialRef }): Promise<void> {
    const copy = this.copies.get(input.credentialRef.id);
    if (!copy) return;
    await copy.backend.delete(copy.id);
    if (await copy.backend.get(copy.id)) throw new Error('copy_delete_failed');
    this.copies.delete(input.credentialRef.id);
    if (input.credentialRef.currentVersionId) {
      this.registry.setVersionStatus(input.credentialRef.currentVersionId, 'revoked');
    }
  }
}

export function assertCredentialRefId(id: string): asserts id is import('@rox/core/platform').CredentialRefId {
  if (!isCredentialRefId(id)) throw new Error('Invalid credential metadata: id');
}
