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
      deviceId: 'device-a',
      workspaceId: 'ws-1',
      category: 'notes',
      type: 'put',
      path: 'inbox.md',
      body: '# Hello from A',
    });
    replica.append({
      deviceId: 'device-a',
      workspaceId: 'ws-1',
      category: 'tasks',
      type: 'put',
      path: 'today.json',
      body: '{"title":"Ship 27"}',
    });

    expect(() =>
      replica.append({
        deviceId: 'device-a',
        workspaceId: 'ws-1',
        category: 'credentials',
        type: 'put',
        path: 'vault',
        body: 'secret',
      }),
    ).toThrow(ReplicaCategoryError);
    expect(() =>
      replica.append({
        deviceId: 'device-a',
        workspaceId: 'ws-1',
        category: 'passkeys',
        type: 'put',
        path: 'os',
        body: 'secret',
      }),
    ).toThrow(ReplicaCategoryError);

    const deviceB = replica.enrollDevice('device-b', 'device-b-secret');
    const key = replica.openDevice(deviceB.id, 'device-b-secret');
    const docs = replica.materialize('ws-1', key);
    expect(docs.get('notes:inbox.md')).toBe('# Hello from A');
    expect(docs.get('tasks:today.json')).toBe('{"title":"Ship 27"}');
    expect([...docs.keys()].some((keyName) => /credential|cookie|passkey/i.test(keyName))).toBe(false);
    expect(replica.categoryStates().filter((row) => row.state === 'excluded').map((row) => row.category)).toEqual([
      'credentials',
      'cookies',
      'passkeys',
    ]);
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

  test('markdown conflicts stay user-visible; settings last-write-wins', () => {
    const conflict = mergeMarkdown('note.md', 'alpha', 'beta');
    expect(conflict.conflict).toEqual({ path: 'note.md', local: 'alpha', remote: 'beta' });
    expect(conflict.value).toContain('<<<<<<< local');
    expect(mergeLww(2, 'new', 1, 'old').value).toBe('new');
    expect(mergeLww(1, 'old', 3, 'newer').value).toBe('newer');
  });

  test('offline queue, incremental sync, export and deletion receipts', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    replica.enqueueOffline({
      ts: Date.now(),
      deviceId: 'device-a',
      accountId: 'acct-1',
      workspaceId: 'ws-1',
      category: 'sessions',
      type: 'put',
      path: 's1',
      body: 'meta',
    });
    replica.flushOffline();
    const snap = replica.snapshot('ws-1');
    expect(snap.items).toHaveLength(1);
    replica.append({
      deviceId: 'device-a',
      workspaceId: 'ws-1',
      category: 'settings',
      type: 'put',
      path: 'ui',
      body: '{"zoom":90}',
    });
    expect(replica.incremental('ws-1', snap.seq)).toHaveLength(1);
    expect(replica.exportBundle('ws-1').items.map((op) => op.category)).toEqual(['sessions', 'settings']);
    const queued = replica.requestDeletion('ws-1');
    expect(queued.status).toBe('queued');
    const done = replica.completeDeletion();
    expect(done.status).toBe('completed');
    expect(replica.materialize('ws-1').size).toBe(0);
  });

  test('revoked device cannot append; recovery unwraps the account key', () => {
    const replica = new AccountReplica('acct-1', 'recovery-secret');
    replica.bindWorkspace('ws-1');
    replica.enrollDevice('device-a', 'device-a-secret');
    replica.revokeDevice('device-a');
    expect(() =>
      replica.append({
        deviceId: 'device-a',
        workspaceId: 'ws-1',
        category: 'notes',
        type: 'put',
        path: 'x.md',
        body: 'nope',
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
