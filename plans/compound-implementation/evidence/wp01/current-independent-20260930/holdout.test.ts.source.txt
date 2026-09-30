import { afterAll, beforeAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import type { SharedProject, SharedProjectResult, ProjectPage } from './baseline/packages/shared/src/workspace-domain/identity/contracts.ts';
import type * as ServerRuntime from './baseline/apps/workspace-service/src/server.ts';
import type * as AuthRuntime from './baseline/apps/workspace-service/src/auth/postgres-identity.ts';
import type * as ClientRuntime from './baseline/packages/server-core/src/transport/client.ts';
import type { WsRpcClient as RpcClient } from './baseline/packages/server-core/src/transport/client.ts';
import type { WsRpcServer } from './baseline/packages/server-core/src/transport/server.ts';
import type { IdentityRepository } from './baseline/apps/workspace-service/src/modules/identity/repository.ts';
import type { PostgresIdentityAuth } from './baseline/apps/workspace-service/src/auth/postgres-identity.ts';

const variant = process.env.HOLDOUT_VARIANT ?? 'baseline';
if (!['baseline', 'mutation'].includes(variant)) throw new Error('Invalid holdout variant');
const root = resolve(import.meta.dir, variant);
// Runtime selection is essential: identical assertions load either exact baseline or isolated mutated source.
const serverModule: typeof ServerRuntime = await import(root + '/apps/workspace-service/src/server.ts');
const authModule: typeof AuthRuntime = await import(root + '/apps/workspace-service/src/auth/postgres-identity.ts');
const clientModule: typeof ClientRuntime = await import(root + '/packages/server-core/src/transport/client.ts');
const { createWorkspaceServer, loadWorkspaceBootstrapMigrations } = serverModule;
const { WsRpcClient } = clientModule;
const seed = 'wp01-independent-list-privacy-20260930-7c31e952';
const runId = crypto.randomUUID();
const schema = 'holdout_' + variant + '_' + runId.replaceAll('-', '').slice(0, 16);
const workspaceId = crypto.randomUUID();
const foreignWorkspaceId = crypto.randomUUID();
const issuer = 'https://holdout.invalid/' + variant + '/' + runId;
const issuerState = resolve(import.meta.dir, 'issuer-' + variant + '-' + runId);
const workspaceName = 'Holdout workspace ' + seed;
const clients: RpcClient[] = [];
let database: SQL | undefined;
let ownerToken = '', memberToken = '', outsiderToken = '';
let baseUrl = '';
let service: { server: WsRpcServer; repository: IdentityRepository; identity: PostgresIdentityAuth; migrations: { applied: readonly string[]; retained: readonly string[] } } | undefined;
let ownerPrincipalId = '', memberPrincipalId = '', outsiderPrincipalId = '';
const created: SharedProjectResult[] = [];
const commands: { commandId: string; schemaVersion: 2; workspaceId: string; idempotencyKey: string; expectedRevision: string; payload: { name: string; workspaceName: string; visibility: 'private' | 'members' } }[] = [];
const observations: Record<string, unknown>[] = [];
const cleanup: Record<string, unknown> = {};
let schemaOwned = false;
let restarts = 0;
const counters = { http: 0, rpc: 0, accountsProvisioned: 0, projectsCreated: 0 };
const migrations = await loadWorkspaceBootstrapMigrations(root + '/apps/workspace-service/migrations');

async function http(path: string, token?: string, body?: unknown) {
  counters.http++;
  const response = await fetch(baseUrl + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  const data: unknown = await response.json();
  return { status: response.status, data };
}
function rpcClient(token: string, selectedWorkspace = workspaceId) {
  const client = new WsRpcClient(baseUrl.replace('http:', 'ws:'), { token, workspaceId: selectedWorkspace, autoReconnect: false, requestTimeout: 5000, connectTimeout: 5000 });
  clients.push(client);
  return client;
}
async function invoke(client: RpcClient, channel: string, body: unknown, selectedWorkspace = workspaceId): Promise<unknown> {
  counters.rpc++;
  return await client.invoke(channel, selectedWorkspace, body);
}
function projectResult(value: unknown): SharedProjectResult {
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || !('receiptId' in value) || typeof value.receiptId !== 'string' || !('data' in value)) throw new Error('Invalid real project receipt');
  // Remaining canonical result fields are asserted by round-trip equality below.
  return value as SharedProjectResult;
}
function pageResult(value: unknown): ProjectPage {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new Error('Invalid Project page');
  for (const item of value.items) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.entity || typeof item.entity.entityId !== 'string') throw new Error('Invalid Project page item');
  }
  if ('nextCursor' in value && typeof value.nextCursor !== 'string') throw new Error('Invalid Project cursor');
  return value as ProjectPage;
}
async function deniedRpc(operation: () => Promise<unknown>, expectedCode: string, label: string) {
  try { await operation(); } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error;
    observations.push({ label, code: error.code, message: error.message });
    expect(error.code, label).toBe(expectedCode);
    for (const project of created.filter(item => item.data.visibility === 'private')) expect(error.message).not.toContain(project.data.name);
    return;
  }
  throw new Error(label + ': unauthorized RPC unexpectedly succeeded');
}
async function startService(url: string) {
  database = new SQL(url, { max: 8 });
  service = await createWorkspaceServer({ database, schema, migrations, serverId: 'independent-holdout-' + runId, host: '127.0.0.1', port: 0,
    authentication: { mode: 'local-bootstrap', configuration: { mode: 'local-bootstrap', issuer, audience: 'wp01-holdout', stateDirectory: issuerState, checkoutDirectory: root, tokenLifetimeSeconds: 900 } } });
  await service.server.listen();
  baseUrl = 'http://127.0.0.1:' + service.server.port;
}

beforeAll(async () => {
  const url = await authModule.loadProtectedWorkspaceDatabaseUrl('/Users/t/.agents/state/rox-compound-workspace/postgres-environment.json');
  database = new SQL(url, { max: 8 });
  await database.unsafe(`CREATE SCHEMA "${schema}"`);
  schemaOwned = true;
  await database.close();
  await startService(url);
  if (!service || !database) throw new Error('No live service');
  const passwords = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const principals = [];
  for (const [index, role] of ['owner', 'member', 'outsider'].entries()) {
    principals.push(await service.identity.provisionAccount(seed + '-' + role + '-' + runId, passwords[index]!));
    counters.accountsProvisioned++;
  }
  ownerPrincipalId = principals[0]!.principalId;
  memberPrincipalId = principals[1]!.principalId;
  outsiderPrincipalId = principals[2]!.principalId;
  await service.repository.provisionWorkspace(ownerPrincipalId, workspaceId, workspaceName);
  await service.repository.provisionWorkspace(outsiderPrincipalId, foreignWorkspaceId, 'Outsider workspace');
  // Privileged fixture membership is confined to this owned schema; no sharing/grant framework is under test.
  await database.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, memberPrincipalId]);
  const tokens: string[] = [];
  for (const [index, role] of ['owner', 'member', 'outsider'].entries()) {
    const login = await http('/v1/auth/local/token', undefined, { login: seed + '-' + role + '-' + runId, password: passwords[index] });
    expect(login.status).toBe(200);
    if (!login.data || typeof login.data !== 'object' || !('token' in login.data) || typeof login.data.token !== 'string') throw new Error('Real issuer did not issue a token');
    tokens.push(login.data.token);
  }
  [ownerToken, memberToken, outsiderToken] = tokens as [string, string, string];
  const owner = rpcClient(ownerToken);
  const visibilityOrder = ['private', 'members', 'private', 'members'] as const;
  for (const [index, visibility] of visibilityOrder.entries()) {
    const command = { commandId: seed + '-create-' + index, schemaVersion: 2 as const, workspaceId, idempotencyKey: seed + '-idem-' + index,
      expectedRevision: '0', payload: { name: seed + '-' + visibility + '-' + index, workspaceName, visibility } };
    commands.push(command);
    const result = index % 2 === 0 ? await http('/v1/workspaces/' + workspaceId + '/commands/project.createShared', ownerToken, command)
      : { status: 200, data: await invoke(owner, 'domain.project.createShared', command) };
    expect(result.status).toBe(200);
    created.push(projectResult(result.data));
    counters.projectsCreated++;
  }
  observations.push({ label: 'before-restart', workspaceId, projectIds: created.map(item => item.entity.entityId), receiptIds: created.map(item => item.receiptId) });
  for (const client of clients.splice(0)) client.destroy();
  service.server.close();
  await database.close();
  await startService(url);
  restarts++;
  observations.push({ label: 'after-restart', retainedMigrations: service!.migrations.retained });
}, 60000);

test('owner reads exact private Project and recovers identical receipt after service and pool restart', async () => {
  const privateProject = created[0]!;
  const detail = await http('/v1/workspaces/' + workspaceId + '/projects/' + privateProject.entity.entityId, ownerToken);
  expect(detail.status).toBe(200);
  expect(detail.data).toEqual(privateProject.data);
  const owner = rpcClient(ownerToken);
  expect(await invoke(owner, 'domain.project.get', { entityId: privateProject.entity.entityId })).toEqual(privateProject.data);
  const retry = await http('/v1/workspaces/' + workspaceId + '/commands/project.createShared', ownerToken, commands[0]);
  expect(retry.status).toBe(200);
  expect(retry.data).toEqual(privateProject);
  const rows = await database!.unsafe<{ projects: number; receipts: number; created_events: number }[]>(`SELECT
    (SELECT count(*)::int FROM "${schema}".project) projects,
    (SELECT count(*)::int FROM "${schema}".project_create_receipt) receipts,
    (SELECT count(*)::int FROM "${schema}".project_event WHERE type = 'project.created') created_events`);
  expect(rows[0]).toEqual({ projects: 4, receipts: 4, created_events: 4 });
  observations.push({ label: 'persisted-exact-counts', ...rows[0] });
});

for (const transport of ['HTTP', 'WS'] as const) {
  test(transport + ' member paginated list must expose only members-visible Projects, never private titles or IDs after restart', async () => {
    const member = rpcClient(memberToken);
    const actual: SharedProject[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      let page: ProjectPage;
      if (transport === 'HTTP') {
        const response = await http('/v1/workspaces/' + workspaceId + '/projects?limit=1' + (cursor ? '&cursor=' + cursor : ''), memberToken);
        expect(response.status).toBe(200);
        page = pageResult(response.data);
      } else page = pageResult(await invoke(member, 'domain.project.list', { limit: 1, ...(cursor ? { cursor } : {}) }));
      observations.push({ label: transport + '-member-page', pageIndex, page });
      const serialized = JSON.stringify(page);
      for (const hidden of created.filter(item => item.data.visibility === 'private')) {
        expect(serialized.includes(hidden.data.name), transport + ' list leaked private Project title').toBe(false);
        expect(serialized.includes(hidden.entity.entityId), transport + ' list leaked private canonical Project ID').toBe(false);
      }
      expect(page.items.length).toBeLessThanOrEqual(1);
      actual.push(...page.items);
      if (!page.nextCursor) break;
      expect(cursors.has(page.nextCursor), 'cursor cycle').toBe(false);
      cursors.add(page.nextCursor);
      cursor = page.nextCursor;
      if (pageIndex === 7) throw new Error('Pagination failed to terminate');
    }
    expect(actual).toEqual(created.filter(item => item.data.visibility === 'members').map(item => item.data));
  });
}

test('member cannot open private detail, cannot forge owner and cannot create even with members visibility', async () => {
  const member = rpcClient(memberToken);
  const hidden = created[0]!;
  const detail = await http('/v1/workspaces/' + workspaceId + '/projects/' + hidden.entity.entityId, memberToken);
  expect(detail).toEqual({ status: 403, data: { error: { code: 'FORBIDDEN' } } });
  await deniedRpc(() => invoke(member, 'domain.project.get', { entityId: hidden.entity.entityId }), 'FORBIDDEN', 'member-private-detail');
  const command = { ...commands[1]!, commandId: seed + '-unauthorized', idempotencyKey: seed + '-unauthorized' };
  const write = await http('/v1/workspaces/' + workspaceId + '/commands/project.createShared', memberToken, command);
  expect(write).toEqual({ status: 403, data: { error: { code: 'FORBIDDEN' } } });
  await deniedRpc(() => invoke(member, 'domain.project.createShared', command), 'FORBIDDEN', 'member-create');
  const forged = { ...command, actor: { principalId: ownerPrincipalId, authenticatedWorkspaceIds: [workspaceId] } };
  expect(await http('/v1/workspaces/' + workspaceId + '/commands/project.createShared', memberToken, forged)).toEqual({ status: 400, data: { error: { code: 'INVALID_PAYLOAD' } } });
  await deniedRpc(() => invoke(member, 'domain.project.createShared', forged), 'INVALID_PAYLOAD', 'forged-owner-body');
  await deniedRpc(() => invoke(member, 'domain.project.get', { entityId: hidden.entity.entityId, principalId: ownerPrincipalId }), 'INVALID_PAYLOAD', 'forged-principal-detail');
});

test('nonmember receives HTTP 403 and established WS denies after live bootstrap membership disappears', async () => {
  const outsiderOwn = rpcClient(outsiderToken, foreignWorkspaceId);
  expect(pageResult(await invoke(outsiderOwn, 'domain.project.list', {}, foreignWorkspaceId)).items).toEqual([]);
  for (const route of ['/projects', '/projects/' + created[0]!.entity.entityId]) {
    expect(await http('/v1/workspaces/' + workspaceId + route, outsiderToken)).toEqual({ status: 403, data: { error: { code: 'FORBIDDEN' } } });
  }
  // A fresh unauthorized WS is rejected during handshake, before any domain handler can run.
  await deniedRpc(() => invoke(rpcClient(outsiderToken), 'domain.project.get', { entityId: created[0]!.entity.entityId }), 'AUTH_FAILED', 'nonmember-fresh-handshake');
  // Establish the real WS while fixture membership exists, then exercise current DB scope on that same connection.
  await database!.unsafe(`INSERT INTO "${schema}".workspace_member (workspace_id,principal_id,role) VALUES ($1,$2,'member')`, [workspaceId, outsiderPrincipalId]);
  const established = rpcClient(outsiderToken);
  await invoke(established, 'domain.project.list', {});
  await database!.unsafe(`DELETE FROM "${schema}".workspace_member WHERE workspace_id = $1 AND principal_id = $2`, [workspaceId, outsiderPrincipalId]);
  await deniedRpc(() => invoke(established, 'domain.project.get', { entityId: created[0]!.entity.entityId }), 'FORBIDDEN', 'nonmember-established-private-detail');
  await deniedRpc(() => invoke(established, 'domain.project.list', {}), 'FORBIDDEN', 'nonmember-established-list');
});

test('client cannot substitute authorized workspace through route or native RPC context', async () => {
  const mismatch = { ...commands[0]!, commandId: seed + '-wrong-workspace', idempotencyKey: seed + '-wrong-workspace', workspaceId: foreignWorkspaceId };
  expect(await http('/v1/workspaces/' + workspaceId + '/commands/project.createShared', ownerToken, mismatch)).toEqual({ status: 403, data: { error: { code: 'WORKSPACE_MISMATCH' } } });
  await deniedRpc(() => invoke(rpcClient(ownerToken), 'domain.project.list', {}, foreignWorkspaceId), 'WORKSPACE_MISMATCH', 'forged-workspace-rpc');
  expect(await http('/v1/workspaces/' + foreignWorkspaceId + '/projects', ownerToken)).toEqual({ status: 403, data: { error: { code: 'FORBIDDEN' } } });
});

afterAll(async () => {
  for (const client of clients.splice(0)) client.destroy();
  service?.server.close();
  cleanup.wsClientsDestroyed = true;
  cleanup.listenerCloseRequested = true;
  if (database && schemaOwned) {
    await database.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    const rows = await database.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1`, [schema]);
    cleanup.remainingOwnedSchemas = rows[0]!.count;
    expect(cleanup.remainingOwnedSchemas).toBe(0);
    cleanup.accountsRemovedWithSchema = counters.accountsProvisioned;
  }
  await database?.close();
  cleanup.poolClosed = true;
  await rm(issuerState, { recursive: true, force: true });
  cleanup.ownedIssuerStateRemoved = true;
  if (baseUrl) {
    const listenerAlive = await new Promise<boolean>((resolveProbe, rejectProbe) => {
      const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(baseUrl).port) });
      socket.setTimeout(2000, () => { socket.destroy(); rejectProbe(new Error('Owned listener cleanup probe timed out')); });
      socket.once('connect', () => { socket.destroy(); resolveProbe(true); });
      socket.once('error', error => {
        socket.destroy();
        if ('code' in error && error.code === 'ECONNREFUSED') resolveProbe(false);
        else rejectProbe(error);
      });
    });
    cleanup.listenerAliveAfterClose = listenerAlive;
    expect(listenerAlive, 'owned HTTP/WS listener remains open').toBe(false);
  }
  await Bun.write(resolve(import.meta.dir, variant + '.evidence.json'), JSON.stringify({ variant, seed, runId, schema, issuer, workspaceId, foreignWorkspaceId,
    principalIds: [ownerPrincipalId, memberPrincipalId, outsiderPrincipalId], restarts, counters, migrations: migrations.map(item => ({ name: item.name, sha256: item.sha256 })),
    scenarioInputSha256: createHash('sha256').update(JSON.stringify(commands)).digest('hex'), commandInputs: commands, observations, cleanup }, null, 2));
}, 20000);
