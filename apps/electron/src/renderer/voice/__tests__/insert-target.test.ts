import { useDomForFile as installDom } from '../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'

installDom()
const { captureInsertTarget, insertDictation, isInsertableElement } = await import('../insert-target')
const { normalizeStatusBarItems } = await import('../../lib/status-bar-items')

describe('dictation insert target (#12)', () => {
  it('captures a focused textarea and inserts at the caret with a space', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.value = 'Hello'
    ta.focus()
    ta.setSelectionRange(5, 5)
    const target = captureInsertTarget(document, true)
    expect(target?.target).toBe(ta)
    let inputs = 0
    ta.addEventListener('input', () => inputs++)
    ta.setSelectionRange(0, 0) // focus moved / caret reset while recording
    expect(insertDictation(target, 'world', true)).toBe(true)
    expect(ta.value).toBe('Hello world')
    expect(inputs).toBe(1)
    ta.remove()
  })
  it('skips non-text inputs, readonly fields and ignored areas; falls back when detached', () => {
    const cb = document.createElement('input'); cb.type = 'checkbox'
    expect(isInsertableElement(cb)).toBe(false)
    const ro = document.createElement('input'); ro.readOnly = true
    expect(isInsertableElement(ro)).toBe(false)
    const wrap = document.createElement('div'); wrap.setAttribute('data-dictation-ignore', '')
    const inner = document.createElement('input'); wrap.appendChild(inner); document.body.appendChild(wrap)
    expect(isInsertableElement(inner)).toBe(false)
    wrap.remove()
    const detached = document.createElement('textarea')
    expect(insertDictation({ target: detached }, 'x', true)).toBe(false)
  })
  it('restores the saved caret in a contenteditable before inserting', () => {
    const ed = document.createElement('div')
    ed.contentEditable = 'true'
    ed.textContent = 'abcd'
    document.body.appendChild(ed)
    ed.focus()
    const r = document.createRange(); r.setStart(ed.firstChild!, 2); r.collapse(true)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(r)
    const capture = captureInsertTarget(document, true)
    expect(capture?.range).toBeDefined()
    document.getSelection()!.removeAllRanges()
    expect(insertDictation(capture, 'X', true)).toBe(true)
    expect(ed.textContent).toBe('abXcd')
    ed.remove()
  })
  it('falls back when the Rox window is not focused or the field is hidden', () => {
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    expect(captureInsertTarget(document, false)).toBeNull()
    const capture = captureInsertTarget(document, true)
    expect(insertDictation(capture, 'x', false)).toBe(false)
    ta.hidden = true
    expect(insertDictation(capture, 'x', true)).toBe(false)
    ta.remove()
  })
})

describe('status bar items (#7)', () => {
  it('keeps canonical order and drops unknown ids', () => {
    // Legacy plain arrays predate sessions/tasks/model/notifications, which default on.
    expect(normalizeStatusBarItems(['version', 'bogus', 'sync'])).toEqual(['sync', 'sessions', 'tasks', 'model', 'notifications', 'version'])
    expect(normalizeStatusBarItems({ v: 2, items: ['version', 'bogus', 'sync'] })).toEqual(['sync', 'version'])
    expect(normalizeStatusBarItems(null).length).toBe(11)
    expect(normalizeStatusBarItems([])).toEqual([])
  })
})
