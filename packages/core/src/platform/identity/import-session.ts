/**
 * Import state machine (CF-3).
 *
 * Required order: discover metadata → candidates → request access → preview →
 * choose mode → conflict check → validate → commit → rollback on failure.
 */

import { ConnectionFabricError } from './provider-contract.ts';
import type { ImportCandidate, ImportPreview } from './provider-contract.ts';
import type { StorageMode } from './credential-types.ts';

export type ImportPhase =
  | 'idle'
  | 'discover_metadata'
  | 'candidates_shown'
  | 'access_requested'
  | 'previewed'
  | 'mode_selected'
  | 'conflict_check'
  | 'validated'
  | 'committed'
  | 'failed'
  | 'rolled_back';

const FORWARD: Record<ImportPhase, readonly ImportPhase[]> = {
  idle: ['discover_metadata', 'failed'],
  discover_metadata: ['candidates_shown', 'failed'],
  candidates_shown: ['access_requested', 'failed'],
  access_requested: ['previewed', 'failed'],
  previewed: ['mode_selected', 'failed'],
  mode_selected: ['conflict_check', 'failed'],
  conflict_check: ['validated', 'candidates_shown', 'failed'],
  validated: ['committed', 'failed'],
  committed: [],
  failed: ['rolled_back'],
  rolled_back: [],
};

export interface ImportConflict {
  readonly conflictKey: string;
  readonly existingFingerprint?: string;
  readonly incomingFingerprint?: string;
  readonly existingCredentialRefId?: string;
  readonly sameFingerprint: boolean;
}

export class ImportSession {
  private phase: ImportPhase = 'idle';
  private sourceId: string | undefined;
  private candidates: ImportCandidate[] = [];
  private selectedId: string | undefined;
  private accessGranted = false;
  private preview: ImportPreview | undefined;
  private mode: StorageMode | undefined;
  private explicitConflictDecision = false;
  private conflict: ImportConflict | undefined;
  private lastError: ConnectionFabricError | undefined;

  getPhase(): ImportPhase {
    return this.phase;
  }

  getSourceId(): string | undefined {
    return this.sourceId;
  }

  getCandidates(): ImportCandidate[] {
    return this.candidates.map((candidate) => ({ ...candidate }));
  }

  getSelectedCandidate(): ImportCandidate | undefined {
    const selected = this.candidates.find((candidate) => candidate.id === this.selectedId);
    return selected ? { ...selected } : undefined;
  }

  getPreview(): ImportPreview | undefined {
    return this.preview ? { ...this.preview, warnings: [...this.preview.warnings] } : undefined;
  }

  getMode(): StorageMode | undefined {
    return this.mode;
  }

  hasExplicitConflictDecision(): boolean {
    return this.explicitConflictDecision;
  }

  getConflict(): ImportConflict | undefined {
    return this.conflict ? { ...this.conflict } : undefined;
  }

  getLastError(): ConnectionFabricError | undefined {
    return this.lastError;
  }

  isAccessGranted(): boolean {
    return this.accessGranted;
  }

  beginDiscover(sourceId: string): void {
    this.transition('discover_metadata');
    this.sourceId = sourceId;
    this.candidates = [];
    this.selectedId = undefined;
    this.accessGranted = false;
    this.preview = undefined;
    this.mode = undefined;
    this.explicitConflictDecision = false;
    this.conflict = undefined;
    this.lastError = undefined;
  }

  recordCandidates(candidates: readonly ImportCandidate[]): void {
    this.assertPhase('discover_metadata');
    this.candidates = candidates.map((candidate) => ({ ...candidate }));
    this.transition('candidates_shown');
  }

  selectCandidate(candidateId: string): ImportCandidate {
    this.assertPhase('candidates_shown');
    const candidate = this.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', candidateId);
    }
    this.selectedId = candidate.id;
    this.accessGranted = false;
    this.preview = undefined;
    this.mode = undefined;
    this.transition('access_requested');
    return { ...candidate };
  }

  grantAccess(): void {
    this.assertPhase('access_requested');
    this.accessGranted = true;
  }

  denyAccess(detail?: string): void {
    this.assertPhase('access_requested');
    this.fail('IMPORT_ACCESS_DENIED', detail);
  }

  recordPreview(preview: ImportPreview): void {
    this.assertPhase('access_requested');
    if (!this.accessGranted) {
      this.fail('IMPORT_ACCESS_DENIED', 'preview before access');
    }
    if (preview.candidateId !== this.selectedId) {
      throw new ConnectionFabricError('IMPORT_CANDIDATE_UNKNOWN', preview.candidateId);
    }
    this.preview = { ...preview, warnings: [...preview.warnings] };
    this.transition('previewed');
  }

  selectMode(mode: StorageMode, options?: { explicitConflictDecision?: boolean }): void {
    this.assertPhase('previewed');
    this.mode = mode;
    this.explicitConflictDecision = options?.explicitConflictDecision === true;
    this.transition('mode_selected');
  }

  beginConflictCheck(): void {
    this.assertPhase('mode_selected');
    this.transition('conflict_check');
  }

  recordConflict(conflict: ImportConflict): void {
    this.assertPhase('conflict_check');
    this.conflict = { ...conflict };
    if (conflict.sameFingerprint) return;
    if (this.explicitConflictDecision) return;
    this.fail('IMPORT_CONFLICT', conflict.conflictKey);
  }

  returnToCandidates(): void {
    this.assertPhase('conflict_check');
    this.selectedId = undefined;
    this.accessGranted = false;
    this.preview = undefined;
    this.mode = undefined;
    this.explicitConflictDecision = false;
    this.conflict = undefined;
    this.transition('candidates_shown');
  }

  markValidated(): void {
    this.assertPhase('conflict_check');
    this.transition('validated');
  }

  markCommitted(): void {
    this.assertPhase('validated');
    this.transition('committed');
  }

  fail(code: ConnectionFabricError['code'], detail?: string): never {
    this.lastError = new ConnectionFabricError(code, detail);
    if (this.phase !== 'failed' && this.phase !== 'rolled_back' && this.phase !== 'committed') {
      this.phase = 'failed';
    }
    throw this.lastError;
  }

  markRolledBack(): void {
    this.assertPhase('failed');
    this.transition('rolled_back');
  }

  requirePhase(...allowed: ImportPhase[]): void {
    if (!allowed.includes(this.phase)) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', this.phase);
    }
  }

  private assertPhase(expected: ImportPhase): void {
    if (this.phase !== expected) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', `${this.phase} != ${expected}`);
    }
  }

  private transition(next: ImportPhase): void {
    const allowed = FORWARD[this.phase];
    if (!allowed.includes(next)) {
      throw new ConnectionFabricError('IMPORT_STATE_INVALID', `${this.phase} -> ${next}`);
    }
    this.phase = next;
  }
}
