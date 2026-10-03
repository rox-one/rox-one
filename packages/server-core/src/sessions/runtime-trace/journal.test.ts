import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeTraceJournal, MAX_RUNTIME_CONTENT_BYTES } from './journal'
import { sanitizeRuntimeTrace } from './privacy'
import { clearRegisteredSecretValues, registerSecretValues } from '@rox/shared/secrets'

const roots: string[] = []
async function directory() { const root = await mkdtemp(join(tmpdir(), 'rox-trace-test-')); roots.push(root); return root }
afterEach(async () => { clearRegisteredSecretValues(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('portable runtime trace journal', () => {
  it('orders concurrent delivery, reloads, and resumes a bounded cursor without duplicating rows', async () => {
    const root = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number; value: number }>(join(root, 'meta', 'runtime-trace'))
    await Promise.all(Array.from({ length: 50 }, (_, value) => journal.append(seq => ({ seq, eventId: `e-${value}`, value }))))
    const reloaded = new RuntimeTraceJournal<{ eventId: string; seq: number; value: number }>(journal.directory)
    const first = await reloaded.snapshot(0, 20)
    expect(first.rows.map(row => row.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(first.hasMore).toBe(true)
    const next = await reloaded.snapshot(first.cursor)
    expect(next.rows).toHaveLength(30)
    expect(next.cursor).toBe(50)
    expect((await reloaded.append(seq => ({ eventId: 'after-restart', seq, value: 51 }))).seq).toBe(51)
  })

  it('keeps producer event identity idempotent across durable replay and resumed append', async () => {
    const root = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number }>(join(root, 'meta', 'runtime-trace'))
    const first = await journal.append(seq => ({ eventId: 'stable-producer-id', seq }))
    const recovered = new RuntimeTraceJournal<{ eventId: string; seq: number }>(journal.directory)
    const duplicate = await recovered.append(seq => ({ eventId: 'stable-producer-id', seq }))
    expect(duplicate).toEqual(first)
    expect((await recovered.snapshot()).rows).toHaveLength(1)
    expect((await recovered.append(seq => ({ eventId: 'next-producer-id', seq }))).seq).toBe(2)
  })

  it('marks torn/corrupt history partial and recovers before appending', async () => {
    const root = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number }>(join(root, 'meta', 'runtime-trace'))
    await journal.append(seq => ({ eventId: 'a', seq }))
    await writeFile(join(journal.directory, 'events.jsonl'), '{"eventId":"a","seq":1}\nnot-json\n{"eventId":"unfinished"', 'utf8')
    const restarted = new RuntimeTraceJournal<{ eventId: string; seq: number }>(journal.directory)
    expect((await restarted.snapshot()).integrity).toBe('partial')
    await restarted.append(seq => ({ eventId: 'b', seq }))
    expect((await new RuntimeTraceJournal<{ eventId: string; seq: number }>(journal.directory).snapshot()).rows.map(row => row.eventId)).toEqual(['a', 'b'])
  })

  it('caps blobs, uses opaque hashes and rejects traversal or tampering', async () => {
    const root = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number }>(join(root, 'meta', 'runtime-trace'))
    const ref = await journal.storeContent('x'.repeat(MAX_RUNTIME_CONTENT_BYTES + 50))
    expect(ref.truncated).toBe(true)
    expect((await journal.readContent(ref.id))?.length).toBe(MAX_RUNTIME_CONTENT_BYTES)
    await expect(journal.readContent('../../private')).rejects.toThrow('Invalid runtime content id')
    await writeFile(join(journal.directory, 'content', `${ref.id}.txt`), 'tampered')
    await expect(journal.readContent(ref.id)).rejects.toThrow('integrity mismatch')
  })

  it('enforces aggregate run blob quota atomically and restores it after restart', async () => {
    const root = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number }>(join(root, 'meta', 'runtime-trace'), { contentBytes: 10, contentFiles: 2 })
    const results = await Promise.allSettled(['aaaa', 'bbbb', 'cccc'].map(text => journal.storeContent(text)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await readdir(join(journal.directory, 'content'))).toHaveLength(2)
    // Reusing a content hash spends no additional bytes or file quota.
    await expect(journal.storeContent('aaaa')).resolves.toBeDefined()
    const recovered = new RuntimeTraceJournal<{ eventId: string; seq: number }>(journal.directory, { contentBytes: 10, contentFiles: 2 })
    await expect(recovered.storeContent('cccc')).rejects.toThrow('quota')
    expect(await readdir(join(journal.directory, 'content'))).toHaveLength(2)
  })

  it('never writes a journal or reads a blob through a symlink', async () => {
    const root = await directory()
    const other = await directory()
    const journal = new RuntimeTraceJournal<{ eventId: string; seq: number }>(join(root, 'meta', 'runtime-trace'))
    await journal.append(seq => ({ eventId: 'a', seq }))
    const reference = await journal.storeContent('safe')
    await rm(join(journal.directory, 'content', `${reference.id}.txt`))
    await writeFile(join(other, 'private'), 'private')
    await symlink(join(other, 'private'), join(journal.directory, 'content', `${reference.id}.txt`))
    await expect(journal.readContent(reference.id)).rejects.toThrow()
    await rm(join(journal.directory, 'events.jsonl'))
    await symlink(join(other, 'private'), join(journal.directory, 'events.jsonl'))
    await expect(journal.append(seq => ({ eventId: 'b', seq }))).rejects.toThrow()
    expect(await readFile(join(other, 'private'), 'utf8')).toBe('private')
  })
})

describe('runtime trace privacy', () => {
  it('scrubs registered credentials and nested/inline credentials before storage while retaining measurements', () => {
    registerSecretValues(['actual-known-value'])
    const input = { inputTokens: 234, outputTokens: 11, content: 'actual-known-value Bearer abcdef api_key=secret123', input: { Authorization: 'Bearer abc', apiKey: 'secret', env: { ROX_TOKEN: 'secret' }, query: 'https://user:pass@example.test?access_token=secret456' } }
    const safe = sanitizeRuntimeTrace(input) as typeof input
    expect(JSON.stringify(safe)).not.toContain('secret123')
    expect(JSON.stringify(safe)).not.toContain('secret456')
    expect(JSON.stringify(safe)).not.toContain('actual-known-value')
    expect(safe.inputTokens).toBe(234)
    expect(safe.outputTokens).toBe(11)
    expect(input.input.apiKey).toBe('secret')
    expect(sanitizeRuntimeTrace('password="quoted private value"')).toBe('password="[REDACTED]"')
    expect(sanitizeRuntimeTrace("password='quoted private value'")).toBe("password='[REDACTED]'")
    expect(sanitizeRuntimeTrace('{"apiKey":"raw JSON private value"}')).not.toContain('raw JSON private value')
    expect(sanitizeRuntimeTrace('Cookie: session=private-cookie; HttpOnly')).toBe('Cookie: [REDACTED]')
  })
})
