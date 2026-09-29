import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isInternalAgentPrompt } from '../internal-prompts.ts'
import { convertForeignSource } from '../import-convert.ts'

describe('internal agent prompts', () => {
  it('matches only known Rox-internal prompt prefixes', () => {
    expect(isInternalAgentPrompt('You are the memory distiller for a coding agent. Distill…')).toBe(true)
    expect(isInternalAgentPrompt('\n You extract durable memory from a chat between a user and an AI assistant.\n…')).toBe(true)
    expect(isInternalAgentPrompt('What is the memory distiller?')).toBe(false)
    expect(isInternalAgentPrompt('')).toBe(false)
    expect(isInternalAgentPrompt(undefined)).toBe(false)
  })

  it('an omp session whose first user turn is the distiller prompt converts to that text', () => {
    // Guards the importer path: import-discover marks such sources skipReason 'internal'.
    const dir = mkdtempSync(join(tmpdir(), 'omp-internal-'))
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '2026-09-29T12-37-04-198Z_x.jsonl')
    writeFileSync(file, [
      JSON.stringify({ type: 'session', version: 3, id: 'x', timestamp: '2026-09-29T12:37:04.198Z', cwd: dir }),
      JSON.stringify({ type: 'message', id: 'm1', parentId: null, timestamp: '2026-09-29T12:37:07.481Z', message: { role: 'user', content: [{ type: 'text', text: 'You are the memory distiller for a coding agent. Distill the window.' }] } }),
      JSON.stringify({ type: 'message', id: 'm2', parentId: 'm1', timestamp: '2026-09-29T12:37:09.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '{"lessons": []}' }] } }),
    ].join('\n'))
    const converted = convertForeignSource(file, 'omp')
    const firstUser = converted.messages.find((m) => m.role === 'user')?.content
    expect(isInternalAgentPrompt(firstUser)).toBe(true)
  })
})
