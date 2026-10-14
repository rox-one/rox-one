import { useDomForFile as installDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { announce, subscribeAnnouncements, type Announcement } from '../announcer'
import { isHelpKeyEvent } from '../../../hooks/useQuestionMarkHelp'
import { findDeadControl } from '../../dev/noop-guard'

installDom()

const key = (over: Partial<KeyboardEvent> & { target?: EventTarget | null }) => ({
  key: '?', metaKey: false, ctrlKey: false, altKey: false, repeat: false, isComposing: false, defaultPrevented: false, target: document.body, ...over,
}) as KeyboardEvent

describe('announce', () => {
  it('delivers trimmed messages and skips empty ones', () => {
    const seen: Announcement[] = []
    const off = subscribeAnnouncements((a) => seen.push(a))
    announce('  3 results  ')
    announce('   ')
    announce('Failed', 'assertive')
    off()
    announce('after unsubscribe')
    expect(seen.map((a) => [a.message, a.politeness])).toEqual([['3 results', 'polite'], ['Failed', 'assertive']])
  })
})

describe('isHelpKeyEvent', () => {
  it('opens on a bare ? outside editable fields', () => {
    expect(isHelpKeyEvent(key({}))).toBe(true)
  })
  it('ignores modifiers, repeats, IME and handled events', () => {
    expect(isHelpKeyEvent(key({ metaKey: true }))).toBe(false)
    expect(isHelpKeyEvent(key({ ctrlKey: true }))).toBe(false)
    expect(isHelpKeyEvent(key({ repeat: true }))).toBe(false)
    expect(isHelpKeyEvent(key({ isComposing: true }))).toBe(false)
    expect(isHelpKeyEvent(key({ defaultPrevented: true }))).toBe(false)
    expect(isHelpKeyEvent(key({ key: '/' }))).toBe(false)
  })
  it('ignores typing in inputs, textareas and contenteditable', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editor.appendChild(inner)
    document.body.append(input, area, editor)
    expect(isHelpKeyEvent(key({ target: input }))).toBe(false)
    expect(isHelpKeyEvent(key({ target: area }))).toBe(false)
    expect(isHelpKeyEvent(key({ target: inner }))).toBe(false)
    input.remove(); area.remove(); editor.remove()
  })
})

describe('findDeadControl', () => {
  it('flags only buttons without any React handler up the tree', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <div>
          <button type="button" data-testid="dead">dead</button>
          <button type="button" data-testid="live" onClick={() => {}}>live</button>
          <div onClick={() => {}}><button type="button" data-testid="delegated"><span data-testid="inner">x</span></button></div>
          <button type="button" data-testid="disabled" disabled>off</button>
          <form><button type="submit" data-testid="submit">go</button></form>
          <span data-testid="plain">text</span>
        </div>,
      )
    })
    const q = (id: string) => host.querySelector(`[data-testid="${id}"]`)
    expect(findDeadControl(q('dead'))).toBe(q('dead'))
    expect(findDeadControl(q('live'))).toBeNull()
    expect(findDeadControl(q('inner'))).toBeNull()
    expect(findDeadControl(q('disabled'))).toBeNull()
    expect(findDeadControl(q('submit'))).toBeNull()
    expect(findDeadControl(q('plain'))).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })
})
