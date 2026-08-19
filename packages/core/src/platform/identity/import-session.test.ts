import { describe, expect, it } from 'bun:test';
import { ImportSession } from './import-session.ts';
import { ConnectionFabricError } from './provider-contract.ts';
import type { ImportCandidate, ImportPreview } from './provider-contract.ts';

const CANDIDATE: ImportCandidate = {
  id: 'dotenv:.env:GH_TOKEN',
  sourceId: 'dotenv',
  kind: 'api_key',
  label: 'GH_TOKEN',
  conflictKey: 'dotenv:.env:GH_TOKEN',
  locator: { type: 'dotenv', path: '.env', key: 'GH_TOKEN' },
  fingerprint: 'a'.repeat(64),
};

const PREVIEW: ImportPreview = {
  candidateId: CANDIDATE.id,
  inferredKind: 'api_key',
  targetProviderId: 'legacy-local',
  proposedMode: 'copy',
  maskedSummary: 'GH_TOKEN=••••',
  warnings: ['no shell expansion'],
};

function reachPreview(session: ImportSession): void {
  session.beginDiscover('dotenv');
  session.recordCandidates([CANDIDATE]);
  session.selectCandidate(CANDIDATE.id);
  session.grantAccess();
  session.recordPreview(PREVIEW);
}

describe('ImportSession', () => {
  it('walks discover → access → preview → validate → commit', () => {
    const session = new ImportSession();
    reachPreview(session);
    session.selectMode('copy');
    session.beginConflictCheck();
    session.markValidated();
    session.markCommitted();
    expect(session.getPhase()).toBe('committed');
    expect(session.getMode()).toBe('copy');
    expect(session.getSelectedCandidate()?.id).toBe(CANDIDATE.id);
  });

  it('denies preview before OS/provider access', () => {
    const session = new ImportSession();
    session.beginDiscover('dotenv');
    session.recordCandidates([CANDIDATE]);
    session.selectCandidate(CANDIDATE.id);
    expect(() => session.recordPreview(PREVIEW)).toThrow(ConnectionFabricError);
    expect(session.getLastError()?.code).toBe('IMPORT_ACCESS_DENIED');
    expect(session.getPhase()).toBe('failed');
  });

  it('denies access from the access_requested phase', () => {
    const session = new ImportSession();
    session.beginDiscover('dotenv');
    session.recordCandidates([CANDIDATE]);
    session.selectCandidate(CANDIDATE.id);
    expect(() => session.denyAccess('os prompt')).toThrow(ConnectionFabricError);
    expect(session.getLastError()?.code).toBe('IMPORT_ACCESS_DENIED');
    expect(session.getPhase()).toBe('failed');
    session.markRolledBack();
    expect(session.getPhase()).toBe('rolled_back');
  });

  it('rejects unknown candidates and illegal transitions', () => {
    const session = new ImportSession();
    expect(() => session.recordCandidates([CANDIDATE])).toThrow(/IMPORT_STATE_INVALID/);
    session.beginDiscover('dotenv');
    session.recordCandidates([CANDIDATE]);
    expect(() => session.selectCandidate('missing')).toThrow(/IMPORT_CANDIDATE_UNKNOWN/);
    expect(() => session.markCommitted()).toThrow(/IMPORT_STATE_INVALID/);
  });

  it('fails closed on a different fingerprint without an explicit decision', () => {
    const session = new ImportSession();
    reachPreview(session);
    session.selectMode('copy');
    session.beginConflictCheck();
    expect(() =>
      session.recordConflict({
        conflictKey: CANDIDATE.conflictKey,
        existingFingerprint: 'b'.repeat(64),
        incomingFingerprint: CANDIDATE.fingerprint,
        sameFingerprint: false,
      }),
    ).toThrow(/IMPORT_CONFLICT/);
    expect(session.getPhase()).toBe('failed');
  });

  it('keeps same-fingerprint conflicts and explicit decisions open', () => {
    const same = new ImportSession();
    reachPreview(same);
    same.selectMode('reference');
    same.beginConflictCheck();
    same.recordConflict({
      conflictKey: CANDIDATE.conflictKey,
      existingFingerprint: CANDIDATE.fingerprint,
      incomingFingerprint: CANDIDATE.fingerprint,
      sameFingerprint: true,
    });
    expect(same.getPhase()).toBe('conflict_check');

    const explicit = new ImportSession();
    reachPreview(explicit);
    explicit.selectMode('copy', { explicitConflictDecision: true });
    explicit.beginConflictCheck();
    explicit.recordConflict({
      conflictKey: CANDIDATE.conflictKey,
      existingFingerprint: 'b'.repeat(64),
      incomingFingerprint: CANDIDATE.fingerprint,
      sameFingerprint: false,
    });
    expect(explicit.getPhase()).toBe('conflict_check');
    expect(explicit.hasExplicitConflictDecision()).toBe(true);
  });

  it('returns clones so callers cannot mutate session state', () => {
    const session = new ImportSession();
    session.beginDiscover('dotenv');
    session.recordCandidates([CANDIDATE]);
    const listed = session.getCandidates() as Array<{ label: string }>;
    listed[0]!.label = 'mutated';
    expect(session.getCandidates()[0]?.label).toBe('GH_TOKEN');
  });
});
