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
    const target = captureInsertTarget()
    expect(target).toBe(ta)
    let inputs = 0
    ta.addEventListener('input', () => inputs++)
    expect(insertDictation(target, 'world')).toBe(true)
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
    expect(insertDictation(detached, 'x')).toBe(false)
  })
})

describe('status bar items (#7)', () => {
  it('keeps canonical order and drops unknown ids', () => {
    expect(normalizeStatusBarItems(['version', 'bogus', 'sync'])).toEqual(['sync', 'version'])
    expect(normalizeStatusBarItems(null).length).toBe(7)
    expect(normalizeStatusBarItems([])).toEqual([])
  })
})
