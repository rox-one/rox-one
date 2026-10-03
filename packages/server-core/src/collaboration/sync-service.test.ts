import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeAuthority } from '../authority/native-authority.ts';
import { NativeJournal, NativeJournalError } from '../authority/native-journal.ts';
import { CollaborationSyncService } from './sync-service.ts';

const roots: string[] = [];
const authorities: NativeAuthority[] = [];
const journals: NativeJournal[] = [];
const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
});

afterEach(() => {
  for (const journal of journals.splice(0)) journal.close();
  for (const authority of authorities.splice(0)) authority.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
});

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'collaboration-sync-')));
  roots.push(base);
  const stateDir = join(base, 'state');
  const nativeRoot = join(base, 'native');
  mkdirSync(nativeRoot);
  const authority = new NativeAuthority({ stateDir });
  authorities.push(authority);
  const admin = authority.bootstrapLocalAdministrator('operator');
  const workspace = authority.registerWorkspace(admin.credential, 'workspace-1', nativeRoot);
  const enroll = (label: string) => {
    const ticket = authority.issueEnrollment(admin.credential, label, Date.now() + 60_000);
    const issued = authority.redeemEnrollment(ticket, label);
    if (!issued) throw new Error('expected test enrollment');
    const principal = authority.authenticate(issued.credential);
    if (!principal) throw new Error('expected authenticated test principal');
    return principal;
  };
  const author = enroll('author-device');
  const reader = enroll('reader-device');
  const stranger = enroll('stranger-device');
  for (const principal of [author, reader]) authority.grantWorkspace(admin.credential, principal.subject, workspace.id, ['read', 'write', 'delete', 'subscribe']);
  const journal = new NativeJournal({
    stateDir,
    authorize: (principal, workspaceId, action, root) => authority.authorize(principal, workspaceId, action, root),
    permissionFence: (principal, workspaceId, action) => authority.permissionFence(principal, workspaceId, action),
    authorizePreparedRecovery: (principal, workspaceId, action, fence, root) => authority.authorizePreparedRecovery(principal, workspaceId, action, fence, root),
  });
  journals.push(journal);
  return { authority, journal, stateDir, workspaceId: workspace.id, author, reader, stranger, service: new CollaborationSyncService(authority, journal) };
}

describe('collaboration replica sync service', () => {
  test('separate authorized principals read durable entity changes and stable retries do not duplicate', () => {
    const { authority, journal, stateDir, service, workspaceId, author, reader } = setup();
    const mutation = {
      kind: 'notes' as const,
      nativeId: 'note-1',
      operationId: 'client-op-1',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'notes/note-1.md', content: '# shared note' }],
    };
    const receipt = service.commit(author, workspaceId, mutation);
    expect(receipt.subject).toBe(author.subject);
    expect(service.commit(author, workspaceId, mutation)).toEqual(receipt);
    expect(() => service.commit(author, workspaceId, { ...mutation, changes: [{ path: 'notes/note-1.md', content: '# altered' }] })).toThrow(NativeJournalError);

    const page = service.pull(reader, workspaceId, 0, 10);
    expect(page.changes.map((change) => change.operationId)).toEqual(['client-op-1']);
    expect(page.entities).toEqual([{ workspaceId, kind: 'notes', nativeId: 'note-1', revision: 1, contentHash: receipt.contentHash, deleted: false, files: [{ path: 'notes/note-1.md', content: '# shared note' }] }]);
    expect(Object.values(page.entities[0]!).some((value) => typeof value === 'string' && value.startsWith('/'))).toBe(false);
    expect(page.nextSequence).toBe(receipt.sequence);
    expect(page.hasMore).toBe(false);
    journal.close();
    const reopenedJournal = new NativeJournal({
      stateDir,
      authorize: (principal, id, action, root) => authority.authorize(principal, id, action, root),
      permissionFence: (principal, id, action) => authority.permissionFence(principal, id, action),
      authorizePreparedRecovery: (principal, id, action, fence, root) => authority.authorizePreparedRecovery(principal, id, action, fence, root),
    });
    journals.push(reopenedJournal);
    const reopenedService = new CollaborationSyncService(authority, reopenedJournal);
    expect(reopenedService.pull(reader, workspaceId, 0, 10)).toEqual(page);
  });

  test('workspace authorization is checked before exposing snapshots or accepting mutations', () => {
    const { service, workspaceId, author, stranger } = setup();
    const mutation = {
      kind: 'notes' as const,
      nativeId: 'note-1',
      operationId: 'denied-op',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'notes/note-1.md', content: 'private' }],
    };
    expect(() => service.commit(stranger, workspaceId, mutation)).toThrow(NativeJournalError);
    service.commit(author, workspaceId, mutation);
    expect(() => service.pull(stranger, workspaceId, 0, 10)).toThrow(NativeJournalError);
  });

  test('unsupported and credential-bearing categories never enter the journal', () => {
    const { service, workspaceId, author } = setup();
    expect(() => service.commit(author, workspaceId, {
      kind: 'credentials',
      nativeId: 'token',
      operationId: 'secret-op',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'credentials/token.json', content: 'secret' }],
    })).toThrow(/registered shared canonical producer/);
    expect(() => service.commit(author, workspaceId, {
      kind: 'tasks',
      nativeId: 'task-1',
      operationId: 'unmapped-task',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'tasks/task-1.json', content: '{}' }],
    })).toThrow(/registered shared canonical producer/);
    expect(() => service.commit(author, workspaceId, {
      kind: 'notes',
      nativeId: 'credential-file',
      operationId: 'credential-path',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'notes/credentials/token.json', content: 'secret' }],
    })).toThrow(/canonical notes directory/);
  });
  test('stale concurrent writes preserve a conflict instead of overwriting the committed revision', () => {
    const { service, workspaceId, author, reader } = setup();
    service.commit(author, workspaceId, {
      kind: 'notes',
      nativeId: 'note-1',
      operationId: 'base-op',
      expectedRevision: null,
      schemaVersion: 1,
      changes: [{ path: 'notes/note-1.md', content: 'base' }],
    });
    service.commit(author, workspaceId, {
      kind: 'notes',
      nativeId: 'note-1',
      operationId: 'first-edit',
      expectedRevision: 1,
      schemaVersion: 1,
      changes: [{ path: 'notes/note-1.md', content: 'first writer' }],
    });
    let conflict: unknown;
    try {
      service.commit(reader, workspaceId, {
        kind: 'notes',
        nativeId: 'note-1',
        operationId: 'stale-edit',
        expectedRevision: 1,
        schemaVersion: 1,
        changes: [{ path: 'notes/note-1.md', content: 'stale writer' }],
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(NativeJournalError);
    expect((conflict as NativeJournalError).code).toBe('CONFLICT');
    expect(service.pull(reader, workspaceId, 0, 10).entities[0]?.files[0]?.content).toBe('first writer');
  });
});
