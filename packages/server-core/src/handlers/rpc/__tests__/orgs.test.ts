import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runOrgRpc(configDir: string): Promise<RunResult> {
  const handlerUrl = pathToFileURL(join(import.meta.dir, '../orgs.ts')).href
  const proc = Bun.spawn({
    cmd: [
      'bun',
      '-e',
      `
process.env.CRAFT_CONFIG_DIR = ${JSON.stringify(configDir)};
process.env.ROX_CONFIG_DIR = ${JSON.stringify(configDir)};
const { mock } = await import('bun:test');
mock.module('@rox/core/rox2', () => ({
  isClaimableLive: () => true,
  rpcOrgsActResult: () => ({ result: {} }),
  rpcOrgsListResult: () => ({ result: {} }),
  rpcOrgsReadResult: () => ({ result: {} }),
}));
const { RPC_CHANNELS } = await import('@rox/shared/protocol');
const { registerOrgsHandlers } = await import(${JSON.stringify(handlerUrl)});
const handlers = new Map();
const server = { handle: (channel, handler, options) => handlers.set(channel, { handler, options }) };
const deps = { platform: { logger: { info() {}, error() {}, warn() {}, debug() {} } } };
registerOrgsHandlers(server, deps);
const invoke = async (channel, ctx, ...args) => {
  const registered = handlers.get(channel);
  if (!registered) throw new Error('missing route: ' + channel);
  return registered.handler(ctx, ...args);
};
const principal = (subject) => ({ issuer: 'server-test', subject, credentialId: 'credential-test', credentialVersion: 1 });
const ownerId = '069a72c6-259e-4e76-b7b3-17e5822cbf36';
const memberId = 'bf42a7d3-fb9a-4b74-97c0-a79c5a2e1f31';
const outsiderId = '9e5820f4-511e-4a3f-b297-e1359ee7f9c1';
const owner = { principal: principal(ownerId) };
const member = { principal: principal(memberId) };
const outsider = { principal: principal(outsiderId) };
const org = await invoke(RPC_CHANNELS.orgs.CREATE, owner, { name: 'RPC team', userId: outsiderId });
if (org.members[0].userId !== ownerId || org.createdBy !== ownerId) throw new Error('creation trusted request identity');
if (org.viewerUserId !== ownerId) throw new Error('creation response lost actor identity');
const ownerOrgs = await invoke(RPC_CHANNELS.orgs.LIST, owner);
if (ownerOrgs.length !== 1 || ownerOrgs[0].viewerUserId !== ownerId || ownerOrgs[0].viewerAuthority !== 'native' || ownerOrgs[0].viewerIssuer !== 'server-test') {
  throw new Error('list did not return scoped principal metadata');
}
if ((await invoke(RPC_CHANNELS.orgs.LIST, outsider)).length !== 0) throw new Error('non-member received organization');
let rosterDenied = false;
try { await invoke(RPC_CHANNELS.orgs.LIST_MEMBERS, outsider, org.id); } catch { rosterDenied = true; }
if (!rosterDenied) throw new Error('non-member received roster');
let emailTargetDenied = false;
try {
  await invoke(RPC_CHANNELS.orgs.INVITE, owner, { orgId: org.id, emailOrUsername: 'person@example.com' });
} catch { emailTargetDenied = true; }
if (!emailTargetDenied) throw new Error('unverified email invitation was accepted');
const invite = await invoke(RPC_CHANNELS.orgs.INVITE, owner, { orgId: org.id, emailOrUsername: memberId });
if (!invite.token || invite.expiresAt <= Date.now()) throw new Error('private issuance omitted token or expiry');
let wrongRecipientDenied = false;
try { await invoke(RPC_CHANNELS.orgs.ACCEPT, outsider, { token: invite.token, userId: memberId }); } catch { wrongRecipientDenied = true; }
if (!wrongRecipientDenied) throw new Error('renderer identity selected acceptance subject');
const accepted = await invoke(RPC_CHANNELS.orgs.ACCEPT, member, { token: invite.token });
if (accepted.member.userId !== memberId || accepted.member.email !== undefined || 'token' in accepted.invite) {
  throw new Error('acceptance lost subject identity, fabricated email, or returned token');
}
const role = await invoke(RPC_CHANNELS.orgs.UPDATE_MEMBER_ROLE, owner, org.id, memberId, 'admin');
if (role.role !== 'admin') throw new Error('role update did not persist');
let memberRoleDenied = false;
try { await invoke(RPC_CHANNELS.orgs.UPDATE_MEMBER_ROLE, member, org.id, ownerId, 'member'); } catch { memberRoleDenied = true; }
if (!memberRoleDenied) throw new Error('non-owner changed member role');
const secondInvite = await invoke(RPC_CHANNELS.orgs.INVITE, owner, { orgId: org.id, emailOrUsername: outsiderId });
const revoked = await invoke(RPC_CHANNELS.orgs.REVOKE_INVITE, owner, org.id, secondInvite.id);
if (!revoked.revokedAt || 'token' in revoked) throw new Error('revocation returned secret or stayed pending');
let revokedDenied = false;
try { await invoke(RPC_CHANNELS.orgs.ACCEPT, outsider, { token: secondInvite.token }); } catch { revokedDenied = true; }
if (!revokedDenied) throw new Error('revoked invite accepted');
const removed = await invoke(RPC_CHANNELS.orgs.REMOVE_MEMBER, owner, org.id, memberId);
let removedRosterDenied = false;
try { await invoke(RPC_CHANNELS.orgs.LIST_MEMBERS, member, org.id); } catch { removedRosterDenied = true; }
if (removed.userId !== memberId || !removedRosterDenied) throw new Error('member removal did not revoke direct roster access');
let lastOwnerRemovalDenied = false;
try { await invoke(RPC_CHANNELS.orgs.REMOVE_MEMBER, owner, org.id, ownerId); } catch { lastOwnerRemovalDenied = true; }
if (!lastOwnerRemovalDenied) throw new Error('last owner removed');
let missingAuthorityDenied = false;
try { await invoke(RPC_CHANNELS.orgs.GET_IDENTITY, member); } catch { missingAuthorityDenied = true; }
if (!missingAuthorityDenied) throw new Error('self profile trusted synthetic principal without authority');
for (const key of [RPC_CHANNELS.orgs.LIST, RPC_CHANNELS.orgs.LIST_MEMBERS, RPC_CHANNELS.orgs.GET_IDENTITY]) {
  if (handlers.get(key).options?.nativeAction !== 'read') throw new Error('read route lacks native read fence');
}
for (const key of [RPC_CHANNELS.orgs.CREATE, RPC_CHANNELS.orgs.INVITE, RPC_CHANNELS.orgs.ACCEPT, RPC_CHANNELS.orgs.UPDATE_MEMBER_ROLE, RPC_CHANNELS.orgs.REMOVE_MEMBER, RPC_CHANNELS.orgs.REVOKE_INVITE]) {
  if (handlers.get(key).options?.nativeAction !== 'write') throw new Error('mutation route lacks native write fence');
}
const persisted = JSON.parse(await (await import('fs')).promises.readFile(${JSON.stringify(join(configDir, 'orgs.json'))}, 'utf8'));
if (!persisted.auditEvents.some((event) => event.action === 'invite' && event.actorUserId === ownerId && event.outcome === 'denied')) {
  throw new Error('denied mutation has no durable audit record');
}
if (!persisted.auditEvents.some((event) => event.action === 'accept' && event.actorUserId === outsiderId && event.outcome === 'denied')) {
  throw new Error('wrong-recipient acceptance has no durable audit record');
}
console.log('ok');
`,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
      ROX_CONFIG_DIR: configDir,
    },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

describe('organization RPC authorization and lifecycle', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('scopes roster and invitation mutations to the server-minted principal', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'org-rpc-'))
    directories.push(configDir)
    const result = await runOrgRpc(configDir)
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
    const persisted = JSON.parse(readFileSync(join(configDir, 'orgs.json'), 'utf8'))
    expect(persisted.members).toHaveLength(1)
    expect(persisted.auditEvents.length).toBeGreaterThanOrEqual(2)
  })
})
