import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useGanttDrag } from '../use-gantt'

useDomForFile()
afterEach(() => { resetDom() })

function Harness({ log }: { log: string[] }) {
  const g = useGanttDrag({ pxPerDay: 10, onCommit: (id, mode, d) => log.push(`commit:${id}:${mode}:${d}`), onClick: (id) => log.push(`click:${id}`) })
  return (
    <div data-testid="root" onPointerMove={g.onPointerMove} onPointerUp={g.onPointerUp}>
      <span data-testid="state">{g.drag ? `drag:${g.drag.deltaDays}` : 'idle'}</span>
      <div data-testid="bar" onPointerDown={(e) => g.onPointerDown(e, 'x', 'move')} onLostPointerCapture={g.onLostPointerCapture} />
    </div>
  )
}

const fire = (el: Element, type: string, init: Record<string, unknown>) =>
  el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }), { pointerId: 1 }))

async function mount() {
  const log: string[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(<Harness log={log} />) })
  const q = (id: string) => container.querySelector(`[data-testid="${id}"]`)!
  return { log, root, q }
}

describe('useGanttDrag', () => {
  it('ignores non-primary buttons', async () => {
    const { q, root } = await mount()
    await act(async () => { fire(q('bar'), 'pointerdown', { button: 2, clientX: 0 }) })
    expect(q('state').textContent).toBe('idle')
    await act(async () => { root.unmount() })
  })

  it('cancels on lost pointer capture without committing', async () => {
    const { q, log, root } = await mount()
    await act(async () => { fire(q('bar'), 'pointerdown', { button: 0, clientX: 0 }) })
    await act(async () => { fire(q('root'), 'pointermove', { clientX: 30 }) })
    expect(q('state').textContent).toBe('drag:3')
    await act(async () => { fire(q('bar'), 'lostpointercapture', {}) })
    expect(q('state').textContent).toBe('idle')
    await act(async () => { fire(q('root'), 'pointerup', { clientX: 30 }) })
    expect(log).toEqual([])
    await act(async () => { root.unmount() })
  })

  it('commits a primary-button drag', async () => {
    const { q, log, root } = await mount()
    await act(async () => { fire(q('bar'), 'pointerdown', { button: 0, clientX: 0 }) })
    await act(async () => { fire(q('root'), 'pointermove', { clientX: 21 }) })
    await act(async () => { fire(q('root'), 'pointerup', { clientX: 21 }) })
    expect(log).toEqual(['commit:x:move:2'])
    await act(async () => { root.unmount() })
  })
})
