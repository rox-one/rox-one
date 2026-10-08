/**
 * Shared wikilink target classifier (#1499 rules, used by extract.ts and the
 * W1-08 editor nodes).
 */
import { describe, expect, it } from 'bun:test'
import { classifyWikilinkTarget, explicitEntityRefFromWikilinkTarget } from '../index.ts'

describe('classifyWikilinkTarget', () => {
  it('explicit entity literals (aliases included) are entities', () => {
    expect(classifyWikilinkTarget('task:42')).toEqual({ type: 'entity', ref: { kind: 'task', id: '42' } })
    expect(classifyWikilinkTarget('doc:2')).toEqual({ type: 'entity', ref: { kind: 'note', id: '2' } })
    expect(classifyWikilinkTarget('note:100%')).toEqual({ type: 'entity', ref: { kind: 'note', id: '100%' } })
    expect(classifyWikilinkTarget('note:abc#Heading')).toEqual({ type: 'entity', ref: { kind: 'note', id: 'abc' } })
  })

  it('unknown kind or whitespace after the colon is a note title', () => {
    expect(classifyWikilinkTarget('Встреча: итоги')).toEqual({ type: 'title', ref: { kind: 'note', id: 'Встреча: итоги' } })
    expect(classifyWikilinkTarget('note: итоги')).toEqual({ type: 'title', ref: { kind: 'note', id: 'note: итоги' } })
    expect(classifyWikilinkTarget('task: что-то')).toEqual({ type: 'title', ref: { kind: 'note', id: 'task: что-то' } })
    expect(classifyWikilinkTarget('My note')).toEqual({ type: 'title', ref: { kind: 'note', id: 'My note' } })
  })

  it('malformed targets classify as nothing (negative)', () => {
    expect(classifyWikilinkTarget('')).toBeNull()
    expect(classifyWikilinkTarget(':x')).toBeNull()
    expect(classifyWikilinkTarget('task:')).toBeNull()
  })

  it('explicitEntityRefFromWikilinkTarget drops note titles', () => {
    expect(explicitEntityRefFromWikilinkTarget('task:1')).toEqual({ kind: 'task', id: '1' })
    expect(explicitEntityRefFromWikilinkTarget('note: итоги')).toBeNull()
    expect(explicitEntityRefFromWikilinkTarget('My note')).toBeNull()
  })
})
