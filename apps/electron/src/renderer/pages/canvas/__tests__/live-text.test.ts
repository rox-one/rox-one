import { describe, expect, it } from 'bun:test'
import * as Y from 'yjs'
import { bindTextArea, diffRange, mapPoint, type TextAreaLike } from '../live-text'

class FakeTextArea implements TextAreaLike {
  value = ''
  selectionStart: number | null = 0
  selectionEnd: number | null = 0
  private l = new Map<string, Set<(e: unknown) => void>>()
  setSelectionRange(s: number, e: number) { this.selectionStart = s; this.selectionEnd = e }
  addEventListener(t: string, fn: (e: unknown) => void) { (this.l.get(t) ?? this.l.set(t, new Set()).get(t)!).add(fn) }
  removeEventListener(t: string, fn: (e: unknown) => void) { this.l.get(t)?.delete(fn) }
  fire(t: string) { for (const fn of this.l.get(t) ?? []) fn({}) }
  /** Simulate the browser: user types `text` at the caret. */
  type(text: string) {
    const s = this.selectionStart ?? 0, e = this.selectionEnd ?? s
    this.value = this.value.slice(0, s) + text + this.value.slice(e)
    this.setSelectionRange(s + text.length, s + text.length)
    this.fire('input')
  }
  backspace() {
    const s = this.selectionStart ?? 0
    if (!s) return
    this.value = this.value.slice(0, s - 1) + this.value.slice(s)
    this.setSelectionRange(s - 1, s - 1)
    this.fire('input')
  }
}
const LOCAL = { local: true }
/** Two peers wired together (local doc ↔ remote doc). */
function peers(initial = '') {
  const a = new Y.Doc(), b = new Y.Doc()
  a.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'from-b') Y.applyUpdate(b, u, 'from-a') })
  b.on('update', (u: Uint8Array, o: unknown) => { if (o !== 'from-a') Y.applyUpdate(a, u, 'from-b') })
  if (initial) a.getText('t').insert(0, initial)
  return { a: a.getText('t'), b: b.getText('t') }
}

describe('diffRange / mapPoint', () => {
  it('minimal range, surrogate-safe', () => {
    expect(diffRange('hello', 'hallo')).toEqual({ index: 1, remove: 1, insert: 'a' })
    expect(diffRange('a😀b', 'a😁b')).toEqual({ index: 1, remove: 2, insert: '😁' })
  })
  it('maps carets through inserts and deletes', () => {
    expect(mapPoint([{ insert: 'xx' }], 3)).toBe(5)
    expect(mapPoint([{ retain: 3 }, { insert: 'xx' }], 3)).toBe(3)
    expect(mapPoint([{ retain: 1 }, { delete: 4 }], 3)).toBe(1)
  })
})

describe('live text binding (S1)', () => {
  it('fast typing: several inputs within one frame all land in order', () => {
    const { a, b } = peers()
    const el = new FakeTextArea()
    bindTextArea(el, a, LOCAL)
    for (const ch of 'Привет, мир') el.type(ch) // no frame in between
    el.backspace(); el.type('р!')
    expect(a.toString()).toBe('Привет, мир!')
    expect(b.toString()).toBe('Привет, мир!')
    expect(el.value).toBe('Привет, мир!')
  })
  it('remote edit is applied in place and keeps selection/caret', () => {
    const { a, b } = peers('hello world')
    const el = new FakeTextArea()
    bindTextArea(el, a, LOCAL)
    el.setSelectionRange(6, 11) // "world" selected
    b.insert(0, '>> ') // remote insert before the selection
    expect(el.value).toBe('>> hello world')
    expect([el.selectionStart, el.selectionEnd]).toEqual([9, 14])
    el.setSelectionRange(14, 14)
    b.insert(14, '!') // remote insert at caret: caret stays
    expect(el.selectionStart).toBe(14)
    b.delete(0, 3)
    expect(el.value).toBe('hello world!')
    expect(el.selectionStart).toBe(11)
    el.type('?')
    expect(b.toString()).toBe('hello world?!')
  })
  it('IME: nothing written while composing; composed text applied on compositionend, mapped through remote edits', () => {
    const { a, b } = peers('ab')
    const el = new FakeTextArea()
    bindTextArea(el, a, LOCAL)
    el.setSelectionRange(2, 2)
    el.fire('compositionstart')
    el.type('k'); el.type('a') // intermediate composition updates
    el.value = 'ab' + 'か'; el.fire('input')
    expect(a.toString()).toBe('ab')
    b.insert(0, 'XY') // remote while composing
    expect(el.value).toBe('abか') // textarea untouched mid-composition
    el.fire('compositionend')
    expect(a.toString()).toBe('XYabか')
    expect(b.toString()).toBe('XYabか')
    expect(el.value).toBe('XYabか')
  })
  it('local edits do not echo back through the observer', () => {
    const { a } = peers('x')
    const el = new FakeTextArea()
    bindTextArea(el, a, LOCAL)
    el.setSelectionRange(1, 1)
    el.type('y')
    expect(el.selectionStart).toBe(2)
  })
  it('IME cancelled with remote edits buffered: caret mapped, next edit not double-mapped', () => {
    const { a, b } = peers('ab')
    const el = new FakeTextArea()
    bindTextArea(el, a, LOCAL)
    el.setSelectionRange(2, 2)
    el.fire('compositionstart')
    b.insert(0, 'XY')
    el.fire('compositionend') // nothing composed
    expect(el.value).toBe('XYab')
    expect(el.selectionStart).toBe(4)
    el.type('!')
    expect(a.toString()).toBe('XYab!')
    expect(b.toString()).toBe('XYab!')
  })
})
