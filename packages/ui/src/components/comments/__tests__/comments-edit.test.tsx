/**
 * W1-08 (#1505 fix2) — entering edit mode starts from the current body, not
 * the body seen at mount (a host update must not be overwritten on save).
 */
import { useDomForFile } from '../../primitives/__tests__/dom-env'
import { afterAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CommentsThread } from '..'

useDomForFile()
const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT
actGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => { actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment })

const author = { id: 'u1', name: 'Анна' }
const comment = (body: string) => ({ id: 'c1', author, body, createdAt: '2026-10-08T05:00:00Z', mine: true })

function editButton(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((b) => /edit/i.test(b.textContent ?? ''))
  if (!button) throw new Error('no edit button')
  return button as HTMLButtonElement
}

describe('CommentsThread edit draft', () => {
  it('seeds the editor from the latest body each time edit mode opens', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onEdit = mock(() => {})
    const render = (body: string) => act(async () => {
      root.render(<CommentsThread comments={[comment(body)] as never} timeZone="UTC" onEdit={onEdit} />)
    })
    await render('Old body')
    // The host updates the body after mount (another device / server echo).
    await render('New body from host')
    await act(async () => { editButton(container).click() })
    const textarea = container.querySelector('textarea')!
    expect(textarea.value).toBe('New body from host')
    await act(async () => { root.unmount() })
    container.remove()
  })
})
