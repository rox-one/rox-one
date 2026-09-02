/**
 * KnowledgeConnectionsStore tests (spec K-04 §3.3.1) — path resolution,
 * save/remove/setStatus upsert semantics, fail-soft parsing of corrupt
 * connections.json, and atomic tmp+rename writes (no tmp files left behind).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { CodedError } from '@craft-agent/shared/protocol'
import { KnowledgeConnectionsStore, normalizeKnowledgeBaseUrl, parseConnectionFile, type KnowledgeConnectionRecord } from '../connections-store'

let configDir: string
const tmpDirs: string[] = []
const PREVIOUS_G2 = process.env.G2_RECORD_PATH

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'knowledge-config-'))
  tmpDirs.push(configDir)
})

afterEach(() => {
  if (PREVIOUS_G2 === undefined) delete process.env.G2_RECORD_PATH
  else process.env.G2_RECORD_PATH = PREVIOUS_G2
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('path resolution', () => {
  it('resolves connections.json under {configDir}/knowledge', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.knowledgeDir).toBe(join(configDir, 'knowledge'))
    expect(store.filePath).toBe(join(configDir, 'knowledge', 'connections.json'))
  })

  it('reads CRAFT_CONFIG_DIR lazily at construction time', () => {
    const prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = configDir
    try {
      const store = new KnowledgeConnectionsStore()
      expect(store.knowledgeDir).toBe(join(configDir, 'knowledge'))
    } finally {
      if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = prev
    }
  })
})

describe('save / list / get', () => {
  it('creates a record with generated uuid, defaults, and ISO timestamps', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.list()).toEqual([])
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'source_bearer::ws-1::conn-1' })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.provider).toBe('siyuan')
    expect(saved.mode).toBe('external-local')
    expect(saved.status).toBe('unknown')
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false)
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false)
    // The file holds no secret material — only the CredentialManager key (K-04 §5).
    expect(Object.keys(saved).sort()).toEqual(
      ['baseUrl', 'createdAt', 'credentialRef', 'id', 'mode', 'provider', 'status', 'updatedAt'].sort(),
    )
    expect(store.list()).toEqual([saved])
    expect(store.get(saved.id)).toEqual(saved)
  })

  it('round-trips optional version and capabilitiesJson', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({
      baseUrl: 'http://localhost:6806',
      credentialRef: 'source_bearer::ws-1::conn-2',
      version: '3.1.20',
      capabilitiesJson: JSON.stringify({ search: true, backlinks: true }),
    })
    expect(store.get(saved.id)).toEqual(saved)
    expect(JSON.parse(store.get(saved.id)!.capabilitiesJson!)).toEqual({ search: true, backlinks: true })
  })

  it('upserts by id: preserves createdAt, refreshes updatedAt, replaces fields', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const created = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'source_bearer::ws-1::conn-3' })
    const updated = store.save({
      id: created.id,
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws-1::conn-3',
      status: 'ok',
      version: '3.1.21',
    })
    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt >= created.createdAt).toBe(true)
    expect(updated.baseUrl).toBe('http://127.0.0.1:6806')
    expect(updated.status).toBe('ok')
    expect(updated.version).toBe('3.1.21')
    expect(store.list()).toHaveLength(1)
  })

  it('creates a new record when save gets an explicit unknown id', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ id: 'conn-explicit', baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(saved.id).toBe('conn-explicit')
    expect(store.get('conn-explicit')).toEqual(saved)
  })

  it('persists local-markdown connections without treating them as SiYuan endpoints', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({
      id: 'local-markdown',
      provider: 'local-markdown',
      mode: 'external-local',
      baseUrl: 'local-markdown://workspace-notes',
      credentialRef: 'source_bearer::ws-1::local-markdown',
      status: 'ok',
    })
    expect(saved.provider).toBe('local-markdown')
    expect(saved.baseUrl).toBe('local-markdown://workspace-notes')
    expect(store.get('local-markdown')).toEqual(saved)
  })

  it('rejects unknown provider writes at runtime', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const error = (() => {
      try {
        store.save({
          id: 'notion',
          provider: 'notion',
          mode: 'external-local',
          baseUrl: 'https://notes.example.com',
          credentialRef: 'ref',
        } as unknown as Parameters<KnowledgeConnectionsStore['save']>[0])
        return null
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(CodedError)
    expect((error as CodedError).code).toBe('INVALID_REF')
    expect(store.list()).toEqual([])
  })

  it('returns null for unknown ids', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.get('nope')).toBeNull()
  })
})

describe('remove / setStatus', () => {
  it('removes an existing record once', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(store.remove(saved.id)).toBe(true)
    expect(store.list()).toEqual([])
    expect(store.remove(saved.id)).toBe(false)
  })

  it('transitions the cached probe status', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    const probed = store.setStatus(saved.id, 'ok')
    expect(probed?.status).toBe('ok')
    expect(store.setStatus(saved.id, 'needs_auth')?.status).toBe('needs_auth')
    expect(store.get(saved.id)?.status).toBe('needs_auth')
    expect(store.setStatus('nope', 'ok')).toBeNull()
  })
})

describe('fail-soft parsing', () => {
  it('treats a corrupt connections.json as empty and recovers on save', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    writeFileSync(store.filePath, 'not json at all {{{')
    expect(store.list()).toEqual([])
    expect(store.get('anything')).toBeNull()
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(store.list()).toEqual([saved])
  })

  it('treats valid JSON with a non-array root as empty', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    writeFileSync(store.filePath, JSON.stringify({ connections: [] }))
    expect(store.list()).toEqual([])
  })

  it('parseConnectionFile skips entries that do not look like records', () => {
    const good: KnowledgeConnectionRecord = {
      id: 'c1', provider: 'siyuan', mode: 'external-local', baseUrl: 'http://localhost:6806',
      credentialRef: 'ref', status: 'unknown', createdAt: '2026-08-07T00:00:00.000Z', updatedAt: '2026-08-07T00:00:00.000Z',
    }
    const parsed = parseConnectionFile(JSON.stringify([good, { id: 42 }, null, 'junk']))
    expect(parsed).toEqual([good])
    expect(parseConnectionFile('{{{ corrupt')).toEqual([])
    expect(parseConnectionFile('')).toEqual([])
  })

  it('keeps legacy records readable by defaulting a missing provider to siyuan', () => {
    const legacy = {
      id: 'legacy-siyuan',
      mode: 'external-local' as const,
      baseUrl: 'http://localhost:6806',
      credentialRef: 'ref',
      status: 'ok' as const,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    }
    expect(parseConnectionFile(JSON.stringify([legacy]))).toEqual([{ ...legacy, provider: 'siyuan' }])
  })

  it('rejects unknown provider records instead of coercing them to siyuan', () => {
    const unknown = {
      id: 'unknown-provider',
      provider: 'notion',
      mode: 'external-local',
      baseUrl: 'https://notes.example.com',
      credentialRef: 'ref',
      status: 'ok',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    }
    expect(parseConnectionFile(JSON.stringify([unknown]))).toEqual([])
  })
})

describe('atomic writes', () => {
  it('leaves no tmp files behind after mutations', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const a = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref-a' })
    store.setStatus(a.id, 'ok')
    store.remove(a.id)
    store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref-b' })
    for (const entry of readdirSync(store.knowledgeDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
    expect(existsSync(store.filePath)).toBe(true)
  })

  it('cleans orphan tmp files on construction', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    const orphan = join(store.knowledgeDir, '.999-1.connections.tmp')
    writeFileSync(orphan, '{"partial":')
    new KnowledgeConnectionsStore(configDir)
    expect(existsSync(orphan)).toBe(false)
  })
})

describe('normalizeKnowledgeBaseUrl', () => {
  it('accepts absolute http(s) URLs and strips trailing slashes', () => {
    expect(normalizeKnowledgeBaseUrl('http://localhost:6806')).toBe('http://localhost:6806')
    expect(normalizeKnowledgeBaseUrl('http://127.0.0.1:6807/')).toBe('http://127.0.0.1:6807')
    expect(normalizeKnowledgeBaseUrl('  https://siyuan.example.com/  ')).toBe('https://siyuan.example.com')
  })

  it('rejects non-URLs and non-http(s) protocols with typed INVALID_REF', () => {
    for (const bad of ['', 'not a url', 'ftp://example.com', 'file:///etc/passwd', 'localhost:6806']) {
      const error = catchNormalize(bad)
      expect(error).toBeInstanceOf(CodedError)
      expect((error as CodedError).code).toBe('INVALID_REF')
    }
  })
})

function catchNormalize(raw: string): unknown {
  try {
    normalizeKnowledgeBaseUrl(raw)
    return null
  } catch (error) {
    return error
  }
}

describe('remote connection TLS', () => {
  it('saves remote https and loopback http', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const httpsSaved = store.save({
      baseUrl: 'https://notes.example.com',
      credentialRef: 'source_bearer::ws::r1',
      mode: 'remote',
    })
    expect(httpsSaved.mode).toBe('remote')
    const loopback = store.save({
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws::r2',
      mode: 'remote',
    })
    expect(loopback.mode).toBe('remote')
    const localhost = store.save({
      baseUrl: 'http://localhost:6806',
      credentialRef: 'source_bearer::ws::r3',
      mode: 'remote',
    })
    expect(localhost.mode).toBe('remote')
  })

  it('rejects non-https non-loopback http with TLS_REQUIRED', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    for (const baseUrl of ['http://notes.example.com', 'http://192.168.1.10:6806', 'http://10.0.0.2']) {
      try {
        store.save({
          baseUrl,
          credentialRef: 'source_bearer::ws::r-bad',
          mode: 'remote',
        })
        throw new Error(`expected TLS_REQUIRED for ${baseUrl}`)
      } catch (error) {
        expect(error).toBeInstanceOf(CodedError)
        expect((error as CodedError).code).toBe('TLS_REQUIRED')
      }
    }
    expect(store.list()).toEqual([])
  })

  it('still rejects managed with CAPABILITY_DISABLED', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    try {
      store.save({
        baseUrl: 'http://127.0.0.1:6806',
        credentialRef: 'source_bearer::ws::m1',
        mode: 'managed',
      })
      throw new Error('expected CAPABILITY_DISABLED')
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError)
      expect((error as CodedError).code).toBe('CAPABILITY_DISABLED')
    }
    expect(store.list()).toEqual([])
  })

  it('saves managed when G2_RECORD_PATH is ACCEPTED variant C', () => {
    const recordPath = join(configDir, 'g2-decision-record.md')
    writeFileSync(
      recordPath,
      '# G2\n\n> **Status: ACCEPTED**\n\nChosen variant C — OEM.\n',
    )
    process.env.G2_RECORD_PATH = recordPath
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({
      baseUrl: 'http://127.0.0.1:19201',
      credentialRef: 'source_bearer::default::siyuan-local',
      mode: 'managed',
    })
    expect(saved.mode).toBe('managed')
    expect(saved.baseUrl).toBe('http://127.0.0.1:19201')
    expect(store.get(saved.id)?.mode).toBe('managed')
  })
})
