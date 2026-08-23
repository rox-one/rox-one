/**
 * access-control — unit tests for the pure permission evaluator.
 *
 * Exhaustive matrix over (workspace mode, binding mode, sender state).
 * Drives both `evaluatePreBindingAccess` (used by Commands) and
 * `evaluateBindingAccess` (used by Router).
 */

import { describe, expect, it } from 'bun:test'
import {
  buildRejectionReply,
  evaluateBindingAccess,
  evaluatePreBindingAccess,
} from '../access-control'
import {
  normalizeBindingConfig,
  type BindingConfig,
  type IncomingMessage,
  type MessagingConfig,
  type PlatformAccessMode,
  type PlatformOwner,
} from '../types'

const OWNER_ID = '111'
const STRANGER_ID = '999'

function buildMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'telegram',
    channelId: 'chat-1',
    messageId: 'm1',
    senderId: OWNER_ID,
    text: 'hi',
    timestamp: Date.now(),
    raw: {},
    ...overrides,
  }
}

function buildConfig(args: {
  accessMode?: PlatformAccessMode
  owners?: PlatformOwner[]
}): MessagingConfig {
  return {
    enabled: true,
    platforms: {
      telegram: {
        enabled: true,
        ...(args.accessMode ? { accessMode: args.accessMode } : {}),
        ...(args.owners ? { owners: args.owners } : {}),
      },
    },
  }
}

function bindingWith(overrides: Partial<BindingConfig> = {}) {
  return {
    config: normalizeBindingConfig('telegram', overrides),
  }
}

const OWNER: PlatformOwner = { userId: OWNER_ID, addedAt: 0 }

// ---------------------------------------------------------------------------
// Pre-binding (Commands) tests
// ---------------------------------------------------------------------------

describe('evaluatePreBindingAccess', () => {
  it('public-inbox mode queues any non-owner stranger', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('queued-for-owner-review')
  })

  it('owner-control mode allows owners', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('owner-only mode rejects non-owners with reason "not-owner"', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('not-owner')
  })

  it('rejects bot senders with reason "bot-sender" regardless of mode', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID, senderIsBot: true }),
      workspaceConfig: buildConfig({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('bot-sender')
  })

  it('owner-only with empty owners list rejects every non-bot sender', () => {
    // Edge case: locked-down workspace with no owners is effectively
    // unusable until /pair seeds the first owner. The evaluator is
    // strict — bootstrap concerns live in handlePair, not here.
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [] }),
    })
    expect(verdict.allow).toBe(false)
  })

  it('missing accessMode defaults to public-inbox queue', () => {
    const verdict = evaluatePreBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({}),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('queued-for-owner-review')
  })
})

// ---------------------------------------------------------------------------
// Bound-channel (Router) tests
// ---------------------------------------------------------------------------

describe('evaluateBindingAccess', () => {
  it('binding public-inbox queues strangers even with workspace owners set', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('queued-for-owner-review')
  })

  it('binding "allow-list" accepts ids in allowedSenderIds', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({
        accessMode: 'owner-control',
        allowedSenderIds: [STRANGER_ID],
      }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('binding "allow-list" rejects ids outside the list', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({
        accessMode: 'owner-control',
        allowedSenderIds: [OWNER_ID],
      }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('not-owner')
  })

  it('binding "inherit" defers to workspace owners (allow path)', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(true)
  })

  it('binding public-inbox defers strangers to the owner queue', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'owner-control', owners: [OWNER] }),
      binding: bindingWith({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('queued-for-owner-review')
  })

  it('public-inbox + public workspace still queues strangers (default-deny)', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: STRANGER_ID }),
      workspaceConfig: buildConfig({ accessMode: 'public-inbox' }),
      binding: bindingWith({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('queued-for-owner-review')
  })

  it('rejects bot senders before any access mode logic runs', () => {
    const verdict = evaluateBindingAccess({
      msg: buildMsg({ senderId: OWNER_ID, senderIsBot: true }),
      workspaceConfig: buildConfig({ accessMode: 'public-inbox' }),
      binding: bindingWith({ accessMode: 'public-inbox' }),
    })
    expect(verdict.allow).toBe(false)
    if (!verdict.allow) expect(verdict.reason).toBe('bot-sender')
  })
})

// ---------------------------------------------------------------------------
// Migration: legacy bindings (no accessMode field) default to 'open'
// ---------------------------------------------------------------------------

describe('normalizeBindingConfig migration', () => {
  it('persisted config without accessMode migrates to public-inbox', () => {
    const raw = { responseMode: 'progress', streamResponses: true } as Partial<BindingConfig>
    const normalized = normalizeBindingConfig('telegram', raw)
    expect(normalized.accessMode).toBe('public-inbox')
    expect(normalized.allowedSenderIds).toEqual([])
  })

  it('fresh BindingConfig defaults to public-inbox', () => {
    const normalized = normalizeBindingConfig('telegram')
    expect(normalized.accessMode).toBe('public-inbox')
  })

  it('explicit accessMode is preserved across normalisation', () => {
    const normalized = normalizeBindingConfig('telegram', {
      accessMode: 'owner-control',
      allowedSenderIds: ['42'],
    })
    expect(normalized.accessMode).toBe('owner-control')
    expect(normalized.allowedSenderIds).toEqual(['42'])
  })
})

// ---------------------------------------------------------------------------
// Reject reply copy
// ---------------------------------------------------------------------------

describe('buildRejectionReply', () => {
  it('returns null for bot-sender (silent drop)', () => {
    expect(buildRejectionReply('bot-sender')).toBeNull()
  })

  it('returns user-friendly text for not-owner', () => {
    const text = buildRejectionReply('not-owner')
    expect(text).toBeTruthy()
    expect(text).toContain('private')
  })

  it('returns user-friendly text for not-on-binding-allowlist', () => {
    const text = buildRejectionReply('not-on-binding-allowlist')
    expect(text).toBeTruthy()
    expect(text).toContain('allow-list')
  })
})

// RX-TSK-0416: workspace-level 'disabled' kill switch.
describe('platform accessMode disabled (RX-TSK-0416)', () => {
  const msg = (senderId: string) =>
    ({ senderId, senderIsBot: false, platform: 'telegram' }) as never
  const ws = (mode: string) => ({
    platforms: { telegram: { accessMode: mode, owners: [{ userId: 'owner-1' }] } },
  }) as never

  it('evaluatePreBindingAccess: blocks everyone, even before pairing', async () => {
    const { evaluatePreBindingAccess } = await import('../access-control.ts')
    const r = evaluatePreBindingAccess({ msg: msg('u1'), workspaceConfig: ws('disabled') })
    expect(r).toEqual({ allow: false, reason: 'mode-disabled' })
  })

  it('evaluateBindingAccess: beats binding-level open and the owners list', async () => {
    const { evaluateBindingAccess } = await import('../access-control.ts')
    const nonOwner = evaluateBindingAccess({
      msg: msg('u1'),
      workspaceConfig: ws('disabled'),
      binding: { config: { accessMode: 'public-inbox' } as never },
    })
    const owner = evaluateBindingAccess({
      msg: msg('owner-1'),
      workspaceConfig: ws('disabled'),
      binding: { config: { accessMode: 'owner-control', allowedSenderIds: [] } as never },
    })
    expect(nonOwner).toEqual({ allow: false, reason: 'mode-disabled' })
    expect(owner).toEqual({ allow: false, reason: 'mode-disabled' })
  })

  it('buildRejectionReply explains the disabled mode', async () => {
    const { buildRejectionReply } = await import('../access-control.ts')
    expect(buildRejectionReply('mode-disabled')).toContain('disabled')
  })
})
