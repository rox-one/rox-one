/**
 * Review 3 #5: the note-title fallbacks (whitespace after `:` / unknown kind)
 * drop the `#Heading` suffix exactly like the plain-title path.
 */
import { describe, expect, it } from 'bun:test'
import { parseWikilinkTarget, wikilinkTargetsToRefs } from '../extract.ts'

describe('note-title fallback strips the heading (review 3 #5)', () => {
  it('whitespace after the colon', () => {
    expect(parseWikilinkTarget('Встреча: итоги#Решения')).toEqual({ kind: 'note', id: 'Встреча: итоги' })
    expect(wikilinkTargetsToRefs('[[Встреча: итоги#Решения]]')).toEqual([{ to: { kind: 'note', id: 'Встреча: итоги' } }])
  })

  it('unknown kind prefix', () => {
    expect(parseWikilinkTarget('Проект:Альфа#Сроки')).toEqual({ kind: 'note', id: 'Проект:Альфа' })
    expect(wikilinkTargetsToRefs('[[Проект:Альфа#Сроки|alias]]')).toEqual([{ to: { kind: 'note', id: 'Проект:Альфа' } }])
  })

  it('agrees with the plain-title path and keeps titles without headings intact', () => {
    expect(parseWikilinkTarget('Итоги#Решения')).toEqual({ kind: 'note', id: 'Итоги' })
    expect(parseWikilinkTarget('Встреча: итоги')).toEqual({ kind: 'note', id: 'Встреча: итоги' })
    expect(parseWikilinkTarget('task:42')).toEqual({ kind: 'task', id: '42' })
  })
})
