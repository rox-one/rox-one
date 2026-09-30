import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from '../../utils/sqlite-runtime.ts';
import { describe, expect, test } from 'bun:test';
import en from '../../i18n/locales/en.json';
import ru from '../../i18n/locales/ru.json';
import {
  AccountReplica,
  ReplicaCategoryError,
  ReplicaTenancyError,
  REPLICA_STATUS_COPY,
  defaultCategoryControls,
  mergeLww,
  mergeMarkdown,
} from '../index.ts';
import { SqliteReplicaOutbox } from '../outbox.ts';

describe('account replica', () => {
  test('status copy does not claim legal or training purposes', () => {
    const queued = en[REPLICA_STATUS_COPY.queued];
    const completed = en[REPLICA_STATUS_COPY.completed];
    const blob = `${queued} ${completed} ${en['accountReplica.title']} ${ru[REPLICA_STATUS_COPY.queued]}`;
    expect(/train|legal|GDPR|product improvement/i.test(blob)).toBe(false);
    expect(ru[REPLICA_STATUS_COPY.queued]).toContain('Локальные данные останутся');
  });

  test('second device recovers allowed categories and excludes credentials', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    replica.append({
      deviceId: 'device-a', workspaceId: 'ws-1', category: 'notes',
      nativeId: 'inbox', expectedRevision: null, schemaVersion: 1,
      changes: [{ path: 'notes/inbox.md', content: '# Hello from A' }],
    });
    replica.append({
      deviceId: 'device-a', workspaceId: 'ws-1', category: 'tasks',
      nativeId: 'today', expectedRevision: null, schemaVersion: 1,
      changes: [{ path: 'tasks/today.json', content: '{"title":"Ship 27"}' }],
    });

    expect(() =>
      replica.append({
        deviceId: 'device-a', workspaceId: 'ws-1', category: 'credentials' as 'notes',
        nativeId: 'vault', expectedRevision: null, schemaVersion: 1,
        changes: [{ path: 'credentials/vault', content: 'secret' }],
      }),
    ).toThrow(ReplicaCategoryError);
    expect(() =>
      replica.append({
        deviceId: 'device-a', workspaceId: 'ws-1', category: 'passkeys' as 'notes',
        nativeId: 'os', expectedRevision: null, schemaVersion: 1,
        changes: [{ path: 'passkeys/os', content: 'secret' }],
      }),
    ).toThrow(ReplicaCategoryError);

    const deviceB = replica.enrollDevice('device-b', 'device-b-secret');
    const key = replica.openDevice(deviceB.id, 'device-b-secret');
    const docs = replica.materialize('ws-1', key);
    expect(docs.get('notes:notes/inbox.md')).toBe('# Hello from A');
    expect(docs.get('tasks:tasks/today.json')).toBe('{"title":"Ship 27"}');
    expect([...docs.keys()].some((keyName) => /credential|cookie|passkey/i.test(keyName))).toBe(false);
    expect(replica.categoryStates().filter((row) => row.state === 'excluded').map((row) => row.category)).toEqual([
      'credentials',
      'cookies',
      'passkeys',
    ]);
  });

  test('restored secure account key preserves device-wrapped identity across process restart', () => {
    const secureKey = Buffer.alloc(32, 19);
    const recoverySecret = 'stored-recovery-secret';
    const first = new AccountReplica('account-hash', recoverySecret, undefined, undefined, secureKey);
    first.bindWorkspace('ws-1');
    first.enrollDevice('device-stable', 'stored-device-secret');
    const firstDeviceKey = first.openDevice('device-stable', 'stored-device-secret');

    const restarted = new AccountReplica('account-hash', recoverySecret, undefined, undefined, secureKey);
    restarted.bindWorkspace('ws-1');
    restarted.enrollDevice('device-stable', 'stored-device-secret');
    expect(restarted.openDevice('device-stable', 'stored-device-secret')).toEqual(firstDeviceKey);
    expect(restarted.recoverAccountKey(recoverySecret)).toEqual(secureKey);
  });

  test('tenancy rejects another account', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    expect(() => replica.snapshot('ws-missing')).toThrow(ReplicaTenancyError);
    const stranger = new AccountReplica('acct-2', 'other-recovery');
    stranger.bindWorkspace('ws-1', 'acct-2');
    expect(() => stranger.assertMembership('acct-1', 'ws-1')).toThrow(ReplicaTenancyError);
  });

  test('markdown conflicts stay visible and equal-time settings writes converge independent of arrival order', () => {
    const conflict = mergeMarkdown('note.md', 'alpha', 'beta');
    expect(conflict.conflict).toEqual({ path: 'note.md', local: 'alpha', remote: 'beta' });
    expect(conflict.value).toContain('<<<<<<< local');
    expect(mergeLww(2, 'new', 1, 'old').value).toBe('new');
    expect(mergeLww(1, 'old', 3, 'newer').value).toBe('newer');
    expect(mergeLww(4, 'left', 4, 'right')).toEqual(mergeLww(4, 'right', 4, 'left'));
  });

  test('offline operations retain stable IDs across reopen and are removed only by a server receipt', () => {
    const stateDir = realpathSync(mkdtempSync(join(tmpdir(), 'replica-outbox-')));
    const linkedDir = join(stateDir, 'linked-parent');
    symlinkSync(stateDir, linkedDir);
    const key = Buffer.alloc(32, 7);
    const databasePath = join(stateDir, 'replica.sqlite');
    expect(() => new SqliteReplicaOutbox({ databasePath: join(linkedDir, 'replica.sqlite'), key })).toThrow(/canonical real directory/);
    try {
      const first = new SqliteReplicaOutbox({ databasePath, key });
      const replica = new AccountReplica('acct-1', 'recovery-secret', undefined, first);
      replica.bindWorkspace('ws-1');
      replica.enrollDevice('device-a', 'device-a-secret');
      const operation = replica.enqueueOffline({
        deviceId: 'device-a',
        workspaceId: 'ws-1',
        category: 'notes',
        nativeId: 'note',
        expectedRevision: null,
        schemaVersion: 1,
        changes: [{ path: 'notes/note.md', content: 'offline edit' }],
      });
      expect(operation.accountId).toBe('acct-1');
      expect(replica.pendingOffline('ws-1')).toEqual([operation]);
      first.enqueue(operation);
      expect(() => first.enqueue({ ...operation, changes: [{ path: '../notes/escape', content: 'bad' }] })).toThrow(/invalid replica operation/);
      expect(() => first.enqueue({ ...operation, changes: [{ path: 'notes/credentials/passwords.json', content: 'secret' }] })).toThrow(/invalid replica operation/);
      expect(() => first.enqueue({ ...operation, changes: [{ path: 'notes/note.md', content: 'changed payload' }] })).toThrow(/reused with different payload/);
      first.close();
      const inspection = new DatabaseSync(databasePath);
      const stored = inspection.prepare('SELECT envelope FROM replica_outbox').get() as { envelope: string };
      expect(stored.envelope).not.toContain('offline edit');
      inspection.close();
      const wrongKey = new SqliteReplicaOutbox({ databasePath, key: Buffer.alloc(32, 8) });
      expect(() => wrongKey.pending('acct-1', 'ws-1')).toThrow();
      wrongKey.close();

      const reopened = new SqliteReplicaOutbox({ databasePath, key });
      const restartedReplica = new AccountReplica('acct-1', 'recovery-secret', undefined, reopened);
      restartedReplica.bindWorkspace('ws-1');
      expect(restartedReplica.pendingOffline('ws-1')).toEqual([operation]);
      expect(restartedReplica.acknowledgeOffline('ws-1', operation.id, { serverSequence: 4, revision: 2 })).toBe(true);
      expect(restartedReplica.pendingOffline('ws-1')).toEqual([]);
      expect(reopened.acknowledgement('acct-1', 'ws-1', operation.id)).toEqual({
        operationId: operation.id,
        serverSequence: 4,
        revision: 2,
      });
      expect(() => reopened.acknowledge('acct-1', 'ws-1', operation.id, { serverSequence: 5, revision: 2 })).toThrow(/acknowledgement changed/);
      expect(reopened.acknowledge('acct-1', 'ws-1', 'unknown', { serverSequence: 5, revision: 2 })).toBe(false);
      reopened.close();
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
  test('local append snapshots and deletion receipts remain consistent', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    const snapshot = replica.snapshot('ws-1');
    replica.append({
      deviceId: 'device-a', workspaceId: 'ws-1', category: 'sessions',
      nativeId: 's1', expectedRevision: null, schemaVersion: 1,
      changes: [{ path: 'sessions/s1', content: 'meta' }],
    });
    replica.append({
      deviceId: 'device-a', workspaceId: 'ws-1', category: 'settings',
      nativeId: 'ui', expectedRevision: null, schemaVersion: 1,
      changes: [{ path: 'settings/ui', content: '{"zoom":90}' }],
    });
    expect(replica.incremental('ws-1', snapshot.seq)).toHaveLength(2);
    expect(replica.exportBundle('ws-1').items.map((op) => op.category)).toEqual(['sessions', 'settings']);
    expect(replica.requestDeletion('ws-1').status).toBe('queued');
    expect(replica.completeDeletion().status).toBe('completed');
    expect(replica.materialize('ws-1').size).toBe(0);
  });

  test('revoked device cannot append; recovery unwraps the account key', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    replica.revokeDevice('device-a');
    expect(() =>
      replica.append({
        deviceId: 'device-a', workspaceId: 'ws-1', category: 'notes',
        nativeId: 'x', expectedRevision: null, schemaVersion: 1,
        changes: [{ path: 'notes/x.md', content: 'nope' }],
      }),
    ).toThrow(/not enrolled/);
    expect(replica.recoverAccountKey('recovery-secret').length).toBe(32);
  });

  test('default controls never include excluded credential categories', () => {
    const controls = defaultCategoryControls();
    expect(controls.find((row) => row.category === 'notes')?.state).toBe('included');
    expect(controls.find((row) => row.category === 'credentials')?.replica).toBe(false);
  });
});

test('destroy wipes owned key buffers, rejects all later custody operations, and retains the durable queue for a fresh session', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'replica-destroy-')));
  const key = Buffer.alloc(32, 5);
  const outboxKey = Buffer.alloc(32, 6);
  const salt = Buffer.from('caller-owned-salt');
  const firstOutbox = new SqliteReplicaOutbox({ databasePath: join(dir, 'queue.sqlite'), key: outboxKey });
  const first = new AccountReplica('account-a', 'recovery', salt, firstOutbox, key);
  first.bindWorkspace('workspace-a');
  first.enrollDevice('device-a', 'device-secret');
  const operation = first.enqueueOffline({ deviceId: 'device-a', workspaceId: 'workspace-a', category: 'notes', nativeId: 'note-a', expectedRevision: 1, schemaVersion: 1, changes: [{ path: 'notes/a.md', content: 'durable draft' }] });
  const owned = first as unknown as { accountKey: Buffer; wrapSalt: Buffer };
  const heldKey = owned.accountKey;
  const heldSalt = owned.wrapSalt;
  first.destroy();
  first.destroy();
  expect(heldKey.equals(Buffer.alloc(32))).toBe(true);
  expect(heldSalt.equals(Buffer.alloc(heldSalt.length))).toBe(true);
  expect(key.equals(Buffer.alloc(32, 5))).toBe(true);
  expect(salt.toString()).toBe('caller-owned-salt');
  for (const action of [
    () => first.bindWorkspace('workspace-a'), () => first.enrollDevice('b', 'secret'),
    () => first.recoverAccountKey('recovery'), () => first.openDevice('device-a', 'device-secret'),
    () => first.rotateAccountKey('recovery', {}), () => first.revokeDevice('device-a'),
    () => first.categoryStates(), () => first.setCategoryControl('notes', true, true),
    () => first.pendingOffline('workspace-a'), () => first.snapshot('workspace-a'),
    () => first.materialize('workspace-a'), () => first.requestDeletion('workspace-a'),
    () => first.completeDeletion(), () => first.deletionReceipt(),
  ]) expect(action).toThrow('destroyed');
  firstOutbox.close();
  const reopenedOutbox = new SqliteReplicaOutbox({ databasePath: join(dir, 'queue.sqlite'), key: outboxKey });
  const reopened = new AccountReplica('account-a', 'recovery', undefined, reopenedOutbox, key);
  reopened.bindWorkspace('workspace-a');
  expect(reopened.pendingOffline('workspace-a')).toEqual([operation]);
  reopened.destroy();
  reopenedOutbox.close();
  rmSync(dir, { recursive: true, force: true });
});

test('authoritative source snapshots are encrypted, persist across reopen, and cannot cross account/workspace/permission epochs', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'replica-source-cache-')));
  const databasePath = join(dir, 'queue.sqlite');
  const key = Buffer.alloc(32, 8);
  const scope = { accountId: 'account-a', workspaceId: 'workspace-a', permissionFence: 'epoch-a' };
  const snapshot = { workspaceId: scope.workspaceId, kind: 'notes', nativeId: 'note-a', revision: 7, contentHash: 'a'.repeat(64), deleted: false, files: [{ path: 'notes/private.md', content: 'PRIVATE-DRAFT-CACHE-CONTENT-8ce7eecb' }] };
  const first = new SqliteReplicaOutbox({ databasePath, key });
  first.cacheSnapshot(scope, snapshot);
  first.close();
  const reopened = new SqliteReplicaOutbox({ databasePath, key });
  expect(reopened.readSnapshot(scope, 'note-a')).toEqual(snapshot);
  for (const other of [{ ...scope, accountId: 'other-account' }, { ...scope, workspaceId: 'other-workspace' }, { ...scope, permissionFence: 'epoch-after-revoke' }]) {
    expect(reopened.readSnapshot(other, 'note-a')).toBeNull();
  }
  const inspect = new DatabaseSync(databasePath);
  const row = inspect.prepare('SELECT envelope FROM native_source_snapshots').get() as { envelope: string };
  expect(row.envelope).not.toContain(snapshot.files[0]!.content);
  expect(row.envelope).not.toContain(snapshot.files[0]!.path);
  inspect.close();
  reopened.invalidateSnapshots(scope);
  reopened.close();
  const invalidated = new SqliteReplicaOutbox({ databasePath, key });
  expect(invalidated.readSnapshot(scope, 'note-a')).toBeNull();
  invalidated.close();
  rmSync(dir, { recursive: true, force: true });
});
