import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const STORAGE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function runInConfigDir(configDir: string, body: string): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: [
      'bun',
      '-e',
      `
process.env.CRAFT_CONFIG_DIR = ${JSON.stringify(configDir)};
process.env.ROX_CONFIG_DIR = ${JSON.stringify(configDir)};
const api = await import(${JSON.stringify(STORAGE_PATH)});
${body}
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

describe('orgs storage', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'craft-orgs-'))
    dirs.push(d)
    return d
  }

  it('creates org with owner membership and persists to orgs.json', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const org = api.createOrganization({ name: 'Acme Team' });
if (org.name !== 'Acme Team') throw new Error('bad name');
if (org.slug !== 'acme-team') throw new Error('bad slug: ' + org.slug);
if (org.members.length !== 1) throw new Error('expected 1 member');
if (org.members[0].role !== 'owner') throw new Error('expected owner');
if (!org.members[0].userId) throw new Error('missing userId');
const listed = api.listOrganizations();
if (listed.length !== 1 || listed[0].id !== org.id) throw new Error('list mismatch');
console.log(JSON.stringify({ id: org.id, userId: org.members[0].userId }));
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const file = join(configDir, 'orgs.json')
    expect(existsSync(file)).toBe(true)
    const store = JSON.parse(readFileSync(file, 'utf-8'))
    expect(store.organizations).toHaveLength(1)
    expect(store.members).toHaveLength(1)
    expect(store.members[0].role).toBe('owner')
  })

  it('stores owner userId, username, and email on the member record', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const { updatePreferences } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, '../../config/preferences.ts')).href)});
updatePreferences({ username: 'ada', email: 'ada@example.com', name: 'Ada' });
const org = api.createOrganization({ name: 'Acme Team' });
const member = org.members[0];
if (member.username !== 'ada') throw new Error('username: ' + member.username);
if (member.email !== 'ada@example.com') throw new Error('email: ' + member.email);
if (!member.userId) throw new Error('missing userId');
const listed = api.listOrganizations()[0].members[0];
if (listed.username !== 'ada' || listed.email !== 'ada@example.com') {
  throw new Error('list hydrate failed');
}
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })


  it('ensures stable local userId across calls', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const a = api.getLocalIdentity();
const b = api.getLocalIdentity();
if (a.userId !== b.userId) throw new Error('userId not stable');
if (a.userId.length < 8) throw new Error('userId too short');
console.log(a.userId);
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const prefs = JSON.parse(readFileSync(join(configDir, 'preferences.json'), 'utf-8'))
    expect(prefs.userId).toBe(result.stdout.trim())
  })

  it('listOrganizations omits invite tokens while create invite returns token', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const org = api.createOrganization({ name: 'Token Guard' });
const invite = api.inviteToOrganization({
  orgId: org.id,
  emailOrUsername: 'secret@example.com',
  role: 'member',
});
if (!invite.token || invite.token.length < 8) throw new Error('create must return token');
const listed = api.listOrganizations();
const pending = listed[0]?.pendingInvites ?? [];
if (pending.length !== 1) throw new Error('expected one pending invite');
if ('token' in pending[0] && pending[0].token !== undefined) {
  throw new Error('list must not expose invite token');
}
const got = api.getOrganization(org.id);
const gotPending = got?.pendingInvites ?? [];
if (gotPending.length !== 1) throw new Error('get expected one pending invite');
if ('token' in gotPending[0] && gotPending[0].token !== undefined) {
  throw new Error('get must not expose invite token');
}
console.log(JSON.stringify({ inviteId: invite.id, token: invite.token }));
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    const { inviteId, token } = JSON.parse(result.stdout.trim()) as {
      inviteId: string
      token: string
    }
    const store = JSON.parse(readFileSync(join(configDir, 'orgs.json'), 'utf-8')) as {
      invites: Array<{ id: string; token?: string }>
    }
    const stored = store.invites.find((i) => i.id === inviteId)
    expect(stored?.token).toBe(token)
  })

  it('rejects an invite addressed to a different account without consuming it', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const { updatePreferences } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, '../../config/preferences.ts')).href)});
updatePreferences({ email: 'ada@example.com' });
const org = api.createOrganization({ name: 'Exact recipient' });
const invite = api.inviteToOrganization({
  orgId: org.id,
  emailOrUsername: 'grace@example.com',
});
let rejected = false;
try { api.acceptInvite({ token: invite.token }); }
catch { rejected = true; }
if (!rejected) throw new Error('wrong recipient accepted invite');
if (api.findInviteByToken(invite.token)?.acceptedAt) throw new Error('failed attempt consumed invite');
if (api.listOrgMembers(org.id).length !== 1) throw new Error('failed attempt changed membership');
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('binds organization access and invitation acceptance to the server principal subject', async () => {
    const configDir = tmp()
    const ownerSubject = '069a72c6-259e-4e76-b7b3-17e5822cbf36'
    const memberSubject = 'bf42a7d3-fb9a-4b74-97c0-a79c5a2e1f31'
    const result = await runInConfigDir(
      configDir,
      `
const org = api.createOrganization({ name: 'Server identity' }, { userId: ${JSON.stringify(ownerSubject)} });
if (org.members[0].userId !== ${JSON.stringify(ownerSubject)}) throw new Error('owner used local profile ID');
const invite = api.inviteToOrganization({
  orgId: org.id,
  emailOrUsername: ${JSON.stringify(memberSubject)},
}, { userId: ${JSON.stringify(ownerSubject)} });
let emailRejected = false;
try {
  api.inviteToOrganization({ orgId: org.id, emailOrUsername: 'person@example.com' }, { userId: ${JSON.stringify(ownerSubject)} });
} catch { emailRejected = true; }
if (!emailRejected) throw new Error('unverified email invite accepted on native path');
let actorSpoofRejected = false;
try {
  api.acceptInvite({ token: invite.token, userId: 'renderer-controlled' }, { userId: ${JSON.stringify(memberSubject)} });
} catch { actorSpoofRejected = true; }
if (!actorSpoofRejected) throw new Error('renderer-supplied userId altered acceptance');
const accepted = api.acceptInvite({ token: invite.token }, { userId: ${JSON.stringify(memberSubject)} });
if (accepted.member.userId !== ${JSON.stringify(memberSubject)}) throw new Error('accepted member ID is not server subject');
if (accepted.member.email !== undefined) throw new Error('unverified invitation target was stored as verified email');
if (api.listOrganizations(${JSON.stringify(memberSubject)}).length !== 1) throw new Error('member cannot read own org');
if (api.listOrganizations('9e5820f4-511e-4a3f-b297-e1359ee7f9c1').length !== 0) throw new Error('non-member can read org');
let denied = false;
try { api.listOrgMembers(org.id, '9e5820f4-511e-4a3f-b297-e1359ee7f9c1'); }
catch { denied = true; }
if (!denied) throw new Error('non-member can read roster');
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('supports owner-fenced role, revoke, and removal lifecycle with an owner invariant', async () => {
    const configDir = tmp()
    const ownerSubject = '069a72c6-259e-4e76-b7b3-17e5822cbf36'
    const memberSubject = 'bf42a7d3-fb9a-4b74-97c0-a79c5a2e1f31'
    const result = await runInConfigDir(
      configDir,
      `
const owner = { userId: ${JSON.stringify(ownerSubject)} };
const org = api.createOrganization({ name: 'Lifecycle' }, owner);
let lastOwnerRemovalRejected = false;
try { api.removeOrganizationMember(org.id, owner.userId, owner); }
catch { lastOwnerRemovalRejected = true; }
if (!lastOwnerRemovalRejected) throw new Error('removed the last owner');
const invite = api.inviteToOrganization({ orgId: org.id, emailOrUsername: ${JSON.stringify(memberSubject)} }, owner);
api.revokeOrganizationInvite(org.id, invite.id, owner);
let revokedAcceptanceRejected = false;
try { api.acceptInvite({ token: invite.token }, { userId: ${JSON.stringify(memberSubject)} }); }
catch { revokedAcceptanceRejected = true; }
if (!revokedAcceptanceRejected) throw new Error('revoked invitation was accepted');
if (api.listOrganizations(owner.userId)[0].pendingInvites.length !== 0) throw new Error('revoked invite still pending');
const nextInvite = api.inviteToOrganization({ orgId: org.id, emailOrUsername: ${JSON.stringify(memberSubject)} }, owner);
api.acceptInvite({ token: nextInvite.token }, { userId: ${JSON.stringify(memberSubject)} });
api.updateMemberRole(org.id, ${JSON.stringify(memberSubject)}, 'admin', owner);
if (api.listOrgMembers(org.id, owner.userId).find((member) => member.userId === ${JSON.stringify(memberSubject)})?.role !== 'admin') {
  throw new Error('role update did not persist');
}
api.removeOrganizationMember(org.id, ${JSON.stringify(memberSubject)}, owner);
if (api.listOrgMembers(org.id, owner.userId).length !== 1) throw new Error('member removal did not persist');
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })

  it('rejects an expired invite without changing membership', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const { readFileSync, writeFileSync } = await import('fs');
const org = api.createOrganization({ name: 'Expired invite' });
const invite = api.inviteToOrganization({ orgId: org.id, emailOrUsername: 'owner@example.com' });
const path = api.getOrgsPath();
const store = JSON.parse(readFileSync(path, 'utf8'));
store.invites[0].expiresAt = 1;
writeFileSync(path, JSON.stringify(store));
let rejected = false;
try { api.acceptInvite({ token: invite.token }); }
catch { rejected = true; }
if (!rejected) throw new Error('expired invite accepted');
if (api.listOrgMembers(org.id).length !== 1) throw new Error('expired invite changed membership');
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
  })
  it('loadOrgsStore fails closed on corrupt existing orgs.json', async () => {
    const configDir = tmp()
    const orgsPath = join(configDir, 'orgs.json')
    writeFileSync(orgsPath, '{not-json', 'utf-8')
    const result = await runInConfigDir(
      configDir,
      `
try {
  api.loadOrgsStore();
  throw new Error('expected loadOrgsStore to throw');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/expected loadOrgsStore to throw/.test(msg)) throw err;
  // preserve corrupt file — do not wipe via empty-store save path
  try {
    api.createOrganization({ name: 'Should Fail Closed' });
    throw new Error('create should not succeed over corrupt store');
  } catch (inner) {
    const innerMsg = inner instanceof Error ? inner.message : String(inner);
    if (/create should not succeed/.test(innerMsg)) throw inner;
  }
  console.log('ok');
}
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
    expect(readFileSync(orgsPath, 'utf-8')).toBe('{not-json')
  })

  it('loadOrgsStore returns empty store when file is missing', async () => {
    const configDir = tmp()
    const result = await runInConfigDir(
      configDir,
      `
const store = api.loadOrgsStore();
if (store.organizations.length !== 0) throw new Error('expected empty orgs');
if (store.members.length !== 0) throw new Error('expected empty members');
if (store.invites.length !== 0) throw new Error('expected empty invites');
console.log('ok');
`,
    )
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('ok')
    expect(existsSync(join(configDir, 'orgs.json'))).toBe(false)
  })
})
