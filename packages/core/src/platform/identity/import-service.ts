/**
 * Main-only import orchestration (CF-3).
 *
 * Renderer, remote, and headless contexts are denied before any importer
 * dispatch. This is the contract Electron main will call later; it is not
 * wired to RPC in this PR.
 */

import {
  createCredentialRefId,
  CredentialRefRegistry,
  type CredentialRefId,
  type StorageMode,
} from './credential-types.ts';
import { metadataFingerprint } from './p0-adapters.ts';
import { ImportSession } from './import-session.ts';
import {
  ConnectionFabricError,
  type CredentialImporter,
  type FabricExecutionContext,
  type ImportCandidate,
  type ImportCommitResult,
  type ImportPreview,
  type SecretProvider,
} from './provider-contract.ts';

export interface CommittedImportRecord {
  readonly conflictKey: string;
  readonly fingerprint?: string;
  readonly credentialRefId: CredentialRefId;
  readonly versionId: string;
}

export interface ImportServiceOptions {
  readonly context: FabricExecutionContext;
  readonly workspaceId: string;
  readonly requestedBy: string;
  readonly registry?: CredentialRefRegistry;
  readonly providers: Readonly<Record<string, SecretProvider>>;
  readonly importers: Readonly<Record<string, CredentialImporter>>;
  readonly existing?: readonly CommittedImportRecord[];
}

export class ImportService {
  readonly session = new ImportSession();
  private readonly context: FabricExecutionContext;
  private readonly workspaceId: string;
  private readonly requestedBy: string;
  private readonly registry: CredentialRefRegistry;
  private readonly providers: Readonly<Record<string, SecretProvider>>;
  private readonly importers: Readonly<Record<string, CredentialImporter>>;
  private readonly ledger: CommittedImportRecord[];
  private lastCommit: ImportCommitResult | undefined;
  private activeImporterId: string | undefined;

  constructor(options: ImportServiceOptions) {
    this.context = options.context;
    this.workspaceId = options.workspaceId;
    this.requestedBy = options.requestedBy;
    this.registry = options.registry ?? new CredentialRefRegistry();
    this.providers = options.providers;
    this.importers = options.importers;
    this.ledger = [...(options.existing ?? [])];
  }

  getRegistry(): CredentialRefRegistry {
    return this.registry;
  }

  listCommitted(): CommittedImportRecord[] {
    return this.ledger.map((record) => ({ ...record }));
  }

  async discover(importerId: string): Promise<ImportCandidate[]> {
    this.assertMain();
    const importer = this.requireImporter(importerId);
    this.activeImporterId = importerId;
    this.session.beginDiscover(importerId);
    const candidates = await importer.discover({
      sourceId: importerId,
      workspaceId: this.workspaceId,
    });
    this.session.recordCandidates(candidates);
    return this.session.getCandidates();
  }

  requestAccess(candidateId: string): ImportCandidate {
    this.assertMain();
    return this.session.selectCandidate(candidateId);
  }

  grantAccess(): void {
    this.assertMain();
    this.session.grantAccess();
  }

  denyAccess(detail?: string): void {
    this.assertMain();
    this.session.denyAccess(detail);
  }

  async preview(targetProviderId: string): Promise<ImportPreview> {
    this.assertMain();
    this.session.requirePhase('access_requested');
    if (!this.session.isAccessGranted()) {
      this.session.fail('IMPORT_ACCESS_DENIED', 'preview');
    }
    const candidate = this.session.getSelectedCandidate();
    if (!candidate || !this.activeImporterId) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', 'no candidate');
    }
    const preview = await this.requireImporter(this.activeImporterId).preview({
      candidateId: candidate.id,
      targetProviderId,
    });
    this.session.recordPreview(preview);
    return this.session.getPreview()!;
  }

  selectMode(mode: StorageMode, options?: { explicitConflictDecision?: boolean }): void {
    this.assertMain();
    this.session.selectMode(mode, options);
  }

  checkConflicts(): void {
    this.assertMain();
    this.session.beginConflictCheck();
    const candidate = this.session.getSelectedCandidate();
    if (!candidate) throw new ConnectionFabricError('IMPORT_STATE_INVALID', 'no candidate');
    const existing = this.ledger.find((record) => record.conflictKey === candidate.conflictKey);
    if (!existing) return;
    const sameFingerprint =
      existing.fingerprint !== undefined &&
      candidate.fingerprint !== undefined &&
      existing.fingerprint === candidate.fingerprint;
    this.session.recordConflict({
      conflictKey: candidate.conflictKey,
      existingFingerprint: existing.fingerprint,
      incomingFingerprint: candidate.fingerprint,
      existingCredentialRefId: existing.credentialRefId,
      sameFingerprint,
    });
  }

  async validate(targetProviderId: string): Promise<void> {
    this.assertMain();
    this.session.requirePhase('conflict_check');
    const candidate = this.session.getSelectedCandidate();
    const mode = this.session.getMode();
    if (!candidate || !mode || !this.activeImporterId) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', 'validate');
    }
    const conflict = this.session.getConflict();
    if (conflict?.sameFingerprint) {
      this.session.markValidated();
      return;
    }
    const result = await this.requireImporter(this.activeImporterId).validate({
      candidateId: candidate.id,
      targetProviderId,
      mode,
    });
    if (!result.ok) {
      this.session.fail(result.errorCode ?? 'IMPORT_VALIDATION_FAILED');
    }
    this.session.markValidated();
  }

  async commit(targetProviderId: string): Promise<ImportCommitResult> {
    this.assertMain();
    this.session.requirePhase('validated');
    const candidate = this.session.getSelectedCandidate();
    const mode = this.session.getMode();
    if (!candidate || !mode || !this.activeImporterId) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', 'commit');
    }
    this.requireProvider(targetProviderId);

    const conflict = this.session.getConflict();
    if (conflict?.sameFingerprint && conflict.existingCredentialRefId) {
      const existing = this.ledger.find((record) => record.credentialRefId === conflict.existingCredentialRefId);
      if (!existing) throw new ConnectionFabricError('IMPORT_STATE_INVALID', 'missing ledger');
      const reused: ImportCommitResult = {
        credentialRefId: existing.credentialRefId,
        versionId: existing.versionId,
        mode,
        reusedExisting: true,
        warnings: ['existing reference reused'],
      };
      this.lastCommit = reused;
      this.session.markCommitted();
      return reused;
    }

    const credentialRefId = createCredentialRefId();
    const locator =
      candidate.locator ??
      { type: 'opaque' as const, provider: this.activeImporterId, locator: candidate.id };

    let result: ImportCommitResult;
    try {
      result = await this.requireImporter(this.activeImporterId).commit({
        candidateId: candidate.id,
        targetProviderId,
        mode,
        workspaceId: this.workspaceId,
        requestedBy: this.requestedBy,
        credentialRefId,
        ...(candidate.fingerprint && /^[0-9a-f]{64}$/.test(candidate.fingerprint)
          ? { versionFingerprint: candidate.fingerprint }
          : {}),
      });
    } catch (error) {
      await this.safeRollback();
      const code =
        error instanceof ConnectionFabricError ? error.code : 'IMPORT_PROVIDER_WRITE_FAILED';
      throw this.session.fail(code, error instanceof Error ? error.message : undefined);
    }

    try {
      this.registry.register({
        id: credentialRefId,
        kind: candidate.kind,
        providerId: targetProviderId,
        locator,
      });
      this.registry.registerVersion({
        id: result.versionId,
        credentialRefId,
        codec: 'stored-credential/v1',
        fingerprint:
          candidate.fingerprint && /^[0-9a-f]{64}$/.test(candidate.fingerprint)
            ? candidate.fingerprint
            : metadataFingerprint(['import', credentialRefId, candidate.conflictKey]),
      });
    } catch (error) {
      await this.safeRollback();
      this.session.fail('IMPORT_ROLLBACK_REQUIRED', error instanceof Error ? error.message : undefined);
    }

    this.ledger.push({
      conflictKey: candidate.conflictKey,
      fingerprint: candidate.fingerprint,
      credentialRefId,
      versionId: result.versionId,
    });
    this.lastCommit = { ...result, credentialRefId };
    this.session.markCommitted();
    return { ...this.lastCommit };
  }

  async rollback(): Promise<void> {
    this.assertMain();
    this.session.requirePhase('failed');
    await this.safeRollback();
    this.session.markRolledBack();
  }

  private async safeRollback(): Promise<void> {
    if (!this.activeImporterId) return;
    await this.requireImporter(this.activeImporterId).rollback({
      commit: this.lastCommit,
      candidateId: this.session.getSelectedCandidate()?.id,
    });
  }

  private assertMain(): void {
    if (this.context !== 'main') {
      throw new ConnectionFabricError('IMPORT_CONTEXT_DENIED', this.context);
    }
  }

  private requireImporter(id: string): CredentialImporter {
    const importer = this.importers[id];
    if (!importer) throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', id);
    return importer;
  }

  private requireProvider(id: string): SecretProvider {
    const provider = this.providers[id];
    if (!provider) throw new ConnectionFabricError('PROVIDER_UNAVAILABLE', id);
    return provider;
  }
}
