import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOmpUserBranchAnchor, serializeOmpUserBranch, type OmpBranchEntry } from '../omp-user-branch'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const entries: OmpBranchEntry[] = [
  { type: 'session', id: 'sdk-parent', version: 3 },
  { type: 'model_change', id: 'model', parentId: null, modelId: 'r1-max' },
  { type: 'message', id: 'u1', parentId: 'model', message: { role: 'user', content: [{ type: 'text', text: 'repeat' }] } },
  { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant' } },
  { type: 'message', id: 'u2', parentId: 'a1', message: { role: 'user', content: [{ type: 'text', text: 'repeat' }] } },
  { type: 'message', id: 'a2', parentId: 'u2', message: { role: 'assistant' } },
]
function fixture() {
  const sessionPath = mkdtempSync(join(tmpdir(), 'rox-omp-user-branch-')); roots.push(sessionPath)
  mkdirSync(join(sessionPath, 'omp'))
  writeFileSync(join(sessionPath, 'omp', '2026_sdk-parent.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  return { sessionPath, sdkSessionId: 'sdk-parent', messages: [
    { id: 'user-1', role: 'user', content: 'repeat' }, { id: 'reply-1', role: 'assistant', content: 'first answer' },
    { id: 'user-2', role: 'user', content: 'repeat' }, { id: 'reply-2', role: 'assistant', content: 'second answer' },
  ], anchors: { 'reply-1': 'a1', 'reply-2': 'a2' } }
}
describe('precise OMP own-message branching', () => {
  it('disambiguates repeated user prompts with surrounding reply anchors', () => {
    const input = fixture()
    expect(resolveOmpUserBranchAnchor({ ...input, messageId: 'user-1' })).toBe('u1')
    expect(resolveOmpUserBranchAnchor({ ...input, messageId: 'user-2' })).toBe('u2')
  })
  it('resolves a currently unanswered tail user after the preceding reply', () => {
    const input = fixture(); input.messages.pop(); delete (input.anchors as Record<string, string>)['reply-2']
    expect(resolveOmpUserBranchAnchor({ ...input, messageId: 'user-2' })).toBe('u2')
  })
  it('resolves provider identity from a copied branch header after a fork', () => {
    const input = fixture()
    renameSync(join(input.sessionPath, 'omp', '2026_sdk-parent.jsonl'), join(input.sessionPath, 'omp', 'branched-1791010000000.jsonl'))
    expect(resolveOmpUserBranchAnchor({ ...input, messageId: 'user-2' })).toBe('u2')
  })
  it('fails closed for ambiguous prompts without anchors and foreign SDK sessions', () => {
    const input = fixture()
    expect(resolveOmpUserBranchAnchor({ ...input, anchors: {}, messageId: 'user-2' })).toBeUndefined()
    expect(resolveOmpUserBranchAnchor({ ...input, sdkSessionId: 'other-parent', messageId: 'user-2' })).toBeUndefined()
  })
  it('includes the selected user and provider metadata, excluding its answer and future turns', () => {
    const copied = serializeOmpUserBranch(entries, 'u2').trim().split('\n').map(line => JSON.parse(line))
    expect(copied.map(entry => entry.id)).toEqual(['sdk-parent', 'model', 'u1', 'a1', 'u2'])
    expect(entries).toHaveLength(6)
  })
  it('follows ancestry instead of leaking sibling transcript branches', () => {
    const siblings = [...entries.slice(0, 4), { type: 'message', id: 'sibling', parentId: 'a1', message: { role: 'user', content: 'private sibling' } }, ...entries.slice(4)]
    expect(serializeOmpUserBranch(siblings, 'u2')).not.toContain('private sibling')
  })
  it('rejects missing and cyclic ancestors and assistant anchors', () => {
    expect(() => serializeOmpUserBranch(entries, 'a2')).toThrow('not a user')
    expect(() => serializeOmpUserBranch([{ type: 'message', id: 'u', parentId: 'missing', message: { role: 'user' } }], 'u')).toThrow('ancestor is missing')
    expect(() => serializeOmpUserBranch([{ type: 'message', id: 'u', parentId: 'u', message: { role: 'user' } }], 'u')).toThrow('ancestry is invalid')
  })
})
