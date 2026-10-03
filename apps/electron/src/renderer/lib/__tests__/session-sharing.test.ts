import { describe, expect, it } from 'bun:test'
import { buildInviteUrl } from '@craft-agent/shared/collaboration'
import { VIEWER_URL } from '@craft-agent/shared/branding'
import {
  SessionLinkError, acceptSessionInvite, copySessionLink, createSessionLink, joinAndOpenSession, parseSessionLink,
} from '../session-sharing'

const inviteUrl = buildInviteUrl('ada', 'sess-1', 'ab'.repeat(16))
const sharedUrl = `${VIEWER_URL}/s/abc_123`

describe('session URL entry', () => {
  it('accepts typed invitation and viewer URLs, including surrounding whitespace', () => {
    expect(parseSessionLink(` ${inviteUrl} `)).toEqual({ kind: 'invite', url: inviteUrl, sessionId: 'sess-1' })
    expect(parseSessionLink(sharedUrl)).toEqual({ kind: 'viewer', url: sharedUrl })
  })

  it('rejects arbitrary clipboard URLs and deceptive or unsupported invitation links', () => {
    for (const url of [
      'https://example.com/session/abc',
      'javascript:alert(1)',
      inviteUrl.replace('https:', 'http:'),
      inviteUrl.replace('bro.rox.one', 'bro.rox.one.example.com'),
      inviteUrl.replace('bro.rox.one', 'bro.rox.one:8443'),
      inviteUrl.replace('https://', 'https://user:password@'),
      `${VIEWER_URL}/s/api`,
      `${VIEWER_URL}/settings`,
      'not a URL',
    ]) {
      expect(parseSessionLink(url)).toBeNull()
    }
  })
})

describe('join request context', () => {
  const destination = parseSessionLink(inviteUrl)!
  if (destination.kind !== 'invite') throw new Error('Expected invitation')

  function fixture() {
    let current = true
    const calls: string[] = []
    const session = { id: 'sess-1', workspaceId: 'workspace-target' }
    const ports = {
      command: async () => ({ ok: true, sessionId: session.id, workspaceId: session.workspaceId }),
      readSession: async () => { calls.push('read'); return session },
      currentWorkspace: () => 'workspace-source',
      switchWorkspace: async () => { calls.push('switch') },
      openSession: async () => { calls.push('open') },
      isCurrent: () => current,
    }
    return { ports, calls, cancel: () => { current = false } }
  }

  it('opens the actual session only after its target workspace switches', async () => {
    const f = fixture()
    await joinAndOpenSession(destination, f.ports)
    expect(f.calls).toEqual(['read', 'switch', 'open'])
  })

  it('does not consume an invitation after the caller has already left', async () => {
    const f = fixture(); f.cancel()
    f.ports.command = async () => { throw new Error('Command must not run') }
    await expect(joinAndOpenSession(destination, f.ports)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.calls).toEqual([])
  })

  it('discards an invitation response after a workspace switch instead of reading or opening it', async () => {
    const f = fixture()
    const command = f.ports.command
    f.ports.command = async () => { f.cancel(); return command() }
    await expect(joinAndOpenSession(destination, f.ports)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.calls).toEqual([])
  })

  it('does not switch workspace after a stale session read', async () => {
    const f = fixture()
    const read = f.ports.readSession
    f.ports.readSession = async () => { f.cancel(); return read() }
    await expect(joinAndOpenSession(destination, f.ports)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.calls).toEqual(['read'])
  })

  it('does not navigate after its asynchronous workspace switch is superseded', async () => {
    const f = fixture()
    f.ports.switchWorkspace = async () => { f.calls.push('switch'); f.cancel() }
    await expect(joinAndOpenSession(destination, f.ports)).rejects.toMatchObject({ code: 'cancelled' })
    expect(f.calls).toEqual(['read', 'switch'])
  })
})

describe('session share and collaborator actions', () => {
  it('publishes the selected session through the real command API', async () => {
    const commands: unknown[] = []
    const link = await createSessionLink(async (sessionId, command) => {
      commands.push({ sessionId, command })
      return { success: true, url: sharedUrl }
    }, 'sess-1', 'share')
    expect(commands).toEqual([{ sessionId: 'sess-1', command: { type: 'shareToViewer' } }])
    expect(link).toEqual({ kind: 'share', url: sharedUrl, expiresAt: undefined })
  })

  it('preserves the invitation expiry and backend membership failure', async () => {
    const link = await createSessionLink(async (_, command) => {
      expect(command.type).toBe('inviteBro')
      return { success: true, url: inviteUrl, expiresAt: 123 }
    }, 'sess-1', 'invite')
    expect(link.expiresAt).toBe(123)
    try {
      await createSessionLink(async () => ({ success: false, error: 'Sign in', errorCode: 'membership_required' }), 'sess-1', 'invite')
      throw new Error('expected invitation to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(SessionLinkError)
      expect((error as SessionLinkError).code).toBe('membership_required')
    }
  })

  it('rejects a wrong-kind link or missing payload instead of reporting success', async () => {
    await expect(createSessionLink(async () => ({ success: true, url: inviteUrl }), 'sess-1', 'share')).rejects.toBeInstanceOf(SessionLinkError)
    await expect(createSessionLink(async () => undefined, 'sess-1', 'invite')).rejects.toBeInstanceOf(SessionLinkError)
    await expect(createSessionLink(async () => ({ success: true, url: inviteUrl }), 'other-session', 'invite')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('propagates transport failures and keeps clipboard failures recoverable', async () => {
    await expect(createSessionLink(async () => { throw new Error('Offline') }, 'sess-1', 'share')).rejects.toThrow('Offline')
    expect(await copySessionLink(sharedUrl, async () => { throw new Error('Clipboard unavailable') })).toBe(false)
    let copied = ''
    expect(await copySessionLink(sharedUrl, async text => { copied = text })).toBe(true)
    expect(copied).toBe(sharedUrl)
  })

  it('joins the typed invite through joinBroInvite and returns the real session', async () => {
    const destination = parseSessionLink(inviteUrl)
    if (destination?.kind !== 'invite') throw new Error('Expected invitation')
    const commands: unknown[] = []
    const joined = await acceptSessionInvite(async (sessionId, command) => {
      commands.push({ sessionId, command })
      return { ok: true, sessionId, role: 'editor', accountId: 'acc-1' }
    }, destination)
    expect(joined).toEqual({ sessionId: 'sess-1', workspaceId: undefined })
    expect(commands).toEqual([{ sessionId: 'sess-1', command: { type: 'joinBroInvite', url: inviteUrl } }])
  })

  it('keeps expired, revoked, consumed and membership denials distinct', async () => {
    const destination = parseSessionLink(inviteUrl)
    if (destination?.kind !== 'invite') throw new Error('Expected invitation')
    for (const denial of ['expired', 'revoked', 'reused', 'membership_required', 'invalid']) {
      try {
        await acceptSessionInvite(async () => ({ ok: false, error: denial }), destination)
        throw new Error('expected join denial')
      } catch (error) {
        expect(error).toBeInstanceOf(SessionLinkError)
        expect((error as SessionLinkError).code).toBe(denial)
      }
    }
  })

  it('rejects a successful response for a different session', async () => {
    const destination = parseSessionLink(inviteUrl)
    if (destination?.kind !== 'invite') throw new Error('Expected invitation')
    await expect(acceptSessionInvite(async () => ({ ok: true, sessionId: 'other' }), destination)).rejects.toBeInstanceOf(SessionLinkError)
  })
})
