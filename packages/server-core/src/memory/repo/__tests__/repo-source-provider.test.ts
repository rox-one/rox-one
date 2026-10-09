import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryRepoSourceProvider,
  formatBankId,
  ownerKey8For,
  ownerKey8FromKey,
  parseBankId,
} from '../RepoSourceProvider'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

function lesson(rule: string, owner?: { issuer: string; subject: string }, scope: 'global' | 'workspace' = 'global'): string {
  return JSON.stringify({
    ts: '2026-09-01T00:00:00.000Z',
    rule,
    category: 'workflow',
    scope,
    source: { trigger: 'explicit' },
    ...(owner ? { owner } : {}),
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('bankId grammar', () => {
  test('parses every legal shape and rejects malformed ids', () => {
    expect(parseBankId('main')).toEqual({ scope: 'main' })
    expect(parseBankId('main#deadbeef')).toEqual({ scope: 'main', ownerKey8: 'deadbeef' })
    expect(parseBankId('ws:abc')).toEqual({ scope: 'workspace', workspaceId: 'abc' })
    expect(parseBankId('ws:abc#deadbeef')).toEqual({ scope: 'workspace', workspaceId: 'abc', ownerKey8: 'deadbeef' })
    expect(parseBankId('main#local')).toEqual({ scope: 'main', ownerKey8: 'local' })
    expect(() => parseBankId('nope')).toThrow()
    expect(() => parseBankId('ws:')).toThrow()
    expect(() => parseBankId('main#XYZ')).toThrow()
  })

  test('formats round-trip and hashes owner keys', () => {
    expect(formatBankId('main')).toBe('main')
    expect(formatBankId('main', undefined, 'deadbeef')).toBe('main#deadbeef')
    expect(formatBankId('workspace', 'abc')).toBe('ws:abc')
    expect(formatBankId('workspace', 'abc', ownerKey8For({ issuer: 'i', subject: 's' }))).toMatch(/^ws:abc#[0-9a-f]{8}$/)
    expect(ownerKey8For()).toBe('local')
    expect(ownerKey8FromKey('')).toBe('local')
    expect(ownerKey8FromKey('i\u0000s')).toHaveLength(8)
  })
})

describe('MemoryRepoSourceProvider', () => {
  function setup() {
    const configDir = tempDir('provider-config')
    const wsRoot = tempDir('provider-ws')
    mkdirSync(join(configDir, 'memory'), { recursive: true })
    writeFileSync(
      join(configDir, 'memory', 'lessons.jsonl'),
      [
        lesson('unowned global rule'),
        lesson('alice rule', { issuer: 'i', subject: 'alice' }),
        lesson('bob rule', { issuer: 'i', subject: 'bob' }),
      ].join('\n') + '\n',
    )
    writeFileSync(join(configDir, 'memory', 'preferences.md'), '# Prefs\nBe kind.\n')

    mkdirSync(join(wsRoot, 'memory', 'history'), { recursive: true })
    writeFileSync(
      join(wsRoot, 'memory', 'lessons.jsonl'),
      [lesson('alice ws rule', { issuer: 'i', subject: 'alice' }, 'workspace'), lesson('unowned ws rule', undefined, 'workspace')].join('\n') + '\n',
    )
    writeFileSync(join(wsRoot, 'memory', 'context.md'), '# Context\nWork stuff.\n')
    writeFileSync(join(wsRoot, 'memory', 'history', '2026-10-01.md'), '# 2026-10-01\n\nDid things.\n')

    const provider = new MemoryRepoSourceProvider({
      configDir,
      getWorkspaces: () => [{ id: 'w1', name: 'Work', rootPath: wsRoot }],
    })
    return { provider, configDir, wsRoot }
  }

  test('lists main plus the active workspaces', async () => {
    const { provider, configDir } = setup()
    const banks = await provider.listBanks()
    expect(banks.map((bank) => bank.id)).toEqual(['main', 'ws:w1'])
    expect(banks[0]).toMatchObject({ scope: 'main', isMain: true })
    expect(banks[0]!.repoPath).toBe(join(configDir, 'memory', 'repos', 'main', 'local'))
    expect(banks[1]!.repoPath).toMatch(/\/ws-[0-9a-f]{8}\/local$/)
    expect(banks[1]!.label).toBe('Work')
  })

  test('local main bank sees unowned rows only; owner banks are isolated', async () => {
    const { provider } = setup()
    const local = await provider.loadBundle('main')
    expect(local.lessons.map((entry) => entry.rule)).toEqual(['unowned global rule'])
    expect(local.preferences).toContain('Be kind.')

    const aliceKey = ownerKey8For({ issuer: 'i', subject: 'alice' })
    const bobKey = ownerKey8For({ issuer: 'i', subject: 'bob' })
    const alice = await provider.loadBundle(`main#${aliceKey}`)
    const bob = await provider.loadBundle(`main#${bobKey}`)
    expect(alice.lessons.map((entry) => entry.rule)).toEqual(['alice rule'])
    expect(bob.lessons.map((entry) => entry.rule)).toEqual(['bob rule'])
    // cross-owner leak guard
    expect(alice.lessons.some((entry) => entry.rule === 'bob rule')).toBe(false)
    expect(alice.lessons.some((entry) => entry.rule === 'unowned global rule')).toBe(false)
  })

  test('workspace bundle carries context/history but never preferences (PROFILE.md stays main-only)', async () => {
    const { provider } = setup()
    const bundle = await provider.loadBundle('ws:w1')
    expect(bundle.scope).toBe('workspace')
    expect(bundle.workspaceName).toBe('Work')
    expect(bundle.preferences).toBeNull()
    expect(bundle.context).toContain('Work stuff.')
    expect(bundle.history).toEqual([{ date: '2026-10-01', content: '# 2026-10-01\n\nDid things.\n' }])
    expect(bundle.lessons.map((entry) => entry.rule).sort()).toEqual(['unowned ws rule'])

    const aliceKey = ownerKey8For({ issuer: 'i', subject: 'alice' })
    const aliceWs = await provider.loadBundle(`ws:w1#${aliceKey}`)
    expect(aliceWs.lessons.map((entry) => entry.rule)).toEqual(['alice ws rule'])
  })

  test('unknown workspace bank throws', async () => {
    const { provider } = setup()
    await expect(provider.loadBundle('ws:missing')).rejects.toThrow()
  })
})