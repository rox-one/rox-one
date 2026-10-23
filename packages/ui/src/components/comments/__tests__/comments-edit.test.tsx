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

  it('renderComposer returning null suppresses the default root TextComposer', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <CommentsThread
          comments={[comment('Body')] as never}
          timeZone="UTC"
          onCreate={() => {}}
          renderComposer={() => null}
        />,
      )
    })
    // Reply UI can still open composers; the section-level root composer must be absent.
    const textareas = container.querySelectorAll('textarea')
    expect(textareas.length).toBe(0)
    await act(async () => { root.unmount() })
    container.remove()
  })

  it('awaits onEdit before closing the editor', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let resolveEdit!: () => void
    const pending = new Promise<void>((resolve) => { resolveEdit = resolve })
    const onEdit = mock(() => pending)
    await act(async () => {
      root.render(<CommentsThread comments={[comment('Original')] as never} timeZone="UTC" onEdit={onEdit} />)
    })
    await act(async () => { editButton(container).click() })
    expect(container.querySelector('textarea')).toBeTruthy()
    const save = [...container.querySelectorAll('button')].find((b) => /save/i.test(b.textContent ?? ''))
    if (!save) throw new Error('no save button')
    await act(async () => { (save as HTMLButtonElement).click() })
    // Still editing while the promise is pending.
    expect(container.querySelector('textarea')).toBeTruthy()
    expect(onEdit).toHaveBeenCalled()
    await act(async () => { resolveEdit() })
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => { root.unmount() })
    container.remove()
  })

  it('keeps the editor open with the draft when onEdit rejects', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onEdit = mock(async () => { throw new Error('boom') })
    await act(async () => {
      root.render(<CommentsThread comments={[comment('Original')] as never} timeZone="UTC" onEdit={onEdit} />)
    })
    await act(async () => { editButton(container).click() })
    expect(container.querySelector('textarea')!.value).toBe('Original')
    const save = [...container.querySelectorAll('button')].find((b) => /save/i.test(b.textContent ?? ''))
    if (!save) throw new Error('no save button')
    await act(async () => { (save as HTMLButtonElement).click() })
    expect(onEdit).toHaveBeenCalledWith('c1', 'Original')
    const still = container.querySelector('textarea')
    expect(still).toBeTruthy()
    expect(still!.value).toBe('Original')
    await act(async () => { root.unmount() })
    container.remove()
  })
  it('disables save while onEdit is in flight', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    let resolveEdit!: () => void
    const pending = new Promise<void>((resolve) => { resolveEdit = resolve })
    const onEdit = mock(() => pending)
    await act(async () => {
      root.render(<CommentsThread comments={[comment('Original')] as never} timeZone="UTC" onEdit={onEdit} />)
    })
    await act(async () => { editButton(container).click() })
    const save = [...container.querySelectorAll('button')].find((b) => /save/i.test(b.textContent ?? '')) as HTMLButtonElement
    if (!save) throw new Error('no save button')
    await act(async () => { save.click() })
    expect(save.disabled).toBe(true)
    expect(container.querySelector('textarea')?.disabled).toBe(true)
    await act(async () => { resolveEdit() })
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => { root.unmount() })
    container.remove()
  })

})
