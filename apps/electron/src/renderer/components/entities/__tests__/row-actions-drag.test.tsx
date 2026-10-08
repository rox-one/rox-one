/**
 * W1-08 (#1505) — common row actions hook + X-13 drag source.
 */
import { mount, resetDom, testWindow } from './test-env'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'
import type { EntityRef } from '@rox/core/entities'
import {
  DEFAULT_ENTITY_ROW_ACTIONS,
  getEntityRowActions,
  registerEntityRowActionHandler,
  resetEntityRowActionHandlers,
} from '../row-actions'
import { ENTITY_REF_MIME, readEntityDragData, setEntityDragData } from '../drag'
import { EntityChip } from '../EntityChip'

const TASK: EntityRef = { kind: 'task', id: '42' }

afterEach(() => {
  resetEntityRowActionHandlers()
  resetDom()
})

class FakeDataTransfer {
  data = new Map<string, string>()
  effectAllowed: DataTransfer['effectAllowed'] = 'all'
  setData(type: string, value: string) { this.data.set(type, value) }
  getData(type: string) { return this.data.get(type) ?? '' }
}

describe('getEntityRowActions', () => {
  it('lists «Спросить @rox», «Закрепить», «Напомнить…» as disabled, inert defaults', async () => {
    const actions = getEntityRowActions(TASK)
    expect(actions.map(({ id, labelKey, disabled }) => ({ id, labelKey, disabled }))).toEqual([
      { id: 'ask-rox', labelKey: 'entities.ui.rowActions.askRox', disabled: true },
      { id: 'pin', labelKey: 'entities.ui.rowActions.pin', disabled: true },
      { id: 'remind', labelKey: 'entities.ui.rowActions.remind', disabled: true },
    ])
    for (const action of actions) {
      expect(typeof action.run).toBe('function')
      expect(await action.run()).toBeUndefined()
    }
  })

  it('enables a default once a handler is registered, and disables it again on unregister', async () => {
    const run = mock((_ref: EntityRef) => {})
    const unregister = registerEntityRowActionHandler('pin', { run })
    const pin = getEntityRowActions(TASK).find((action) => action.id === 'pin')!
    expect(pin.disabled).toBe(false)
    await pin.run()
    expect(run).toHaveBeenCalledWith(TASK)
    unregister()
    expect(getEntityRowActions(TASK).find((action) => action.id === 'pin')!.disabled).toBe(true)
  })

  it('respects isAvailable per ref and supports extra actions with a labelKey', () => {
    registerEntityRowActionHandler('remind', { run: () => {}, isAvailable: (ref) => ref.kind === 'task' })
    registerEntityRowActionHandler('share', { run: () => {}, labelKey: 'entities.ui.card.copyLink' })
    expect(getEntityRowActions(TASK).find((a) => a.id === 'remind')!.disabled).toBe(false)
    expect(getEntityRowActions({ kind: 'note', id: 'n' }).find((a) => a.id === 'remind')!.disabled).toBe(true)
    expect(getEntityRowActions(TASK).map((a) => a.id)).toEqual(['ask-rox', 'pin', 'remind', 'share'])
  })

  it('rejects an empty id or a custom action without labelKey (negative)', () => {
    expect(() => registerEntityRowActionHandler('', { run: () => {} })).toThrow()
    expect(() => registerEntityRowActionHandler('custom', { run: () => {} })).toThrow()
    expect(getEntityRowActions(TASK)).toHaveLength(DEFAULT_ENTITY_ROW_ACTIONS.length)
  })

  it('chip context menu shows the defaults disabled (RU)', async () => {
    const mounted = await mount(<EntityChip entityRef={TASK} label="Release" previewsEnabled={false} />)
    const chip = mounted.container.querySelector('button')!
    await act(async () => {
      chip.dispatchEvent(new testWindow.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }) as unknown as Event)
    })
    const items = Array.from(document.body.querySelectorAll('[data-entity-row-action]'))
    const text = document.body.textContent ?? ''
    await mounted.unmount()
    expect(items.map((item) => item.getAttribute('data-entity-row-action'))).toEqual(['ask-rox', 'pin', 'remind'])
    for (const item of items) expect(item.getAttribute('data-disabled')).not.toBeNull()
    expect(text).toContain('Спросить @rox')
    expect(text).toContain('Закрепить')
    expect(text).toContain('Напомнить…')
    expect(text).toContain('Копировать ссылку')
  })
})

describe('drag source (application/x-rox-entity-ref)', () => {
  it('writes the formatted ref + label as JSON under the X-13 MIME type only', () => {
    const dt = new FakeDataTransfer()
    const payload = setEntityDragData(dt, { kind: 'task', id: 'a b' }, 'Release')
    expect(ENTITY_REF_MIME).toBe('application/x-rox-entity-ref')
    expect([...dt.data.keys()]).toEqual([ENTITY_REF_MIME])
    expect(JSON.parse(dt.getData(ENTITY_REF_MIME))).toEqual({ ref: payload.ref, label: 'Release' })
    expect(dt.effectAllowed).toBe('copyLink')
    expect(readEntityDragData(dt)).toEqual({ ref: payload.ref, label: 'Release', entityRef: { kind: 'task', id: 'a b' } })
  })

  it('returns null for missing, malformed or invalid payloads (negative)', () => {
    const cases = ['', 'not json', '[]', '{"ref":1,"label":"x"}', '{"ref":"nope:1","label":"x"}', '{"ref":"task:42"}']
    for (const raw of cases) {
      const dt = new FakeDataTransfer()
      if (raw) dt.setData(ENTITY_REF_MIME, raw)
      expect(readEntityDragData(dt)).toBeNull()
    }
  })

  it('chips are draggable and set the payload on dragstart; restricted chips drag the kind, not the title', async () => {
    const mounted = await mount(<EntityChip entityRef={TASK} label="Release" previewsEnabled={false} />)
    const chip = mounted.container.querySelector('button')!
    expect(chip.getAttribute('draggable')).toBe('true')
    const dt = new FakeDataTransfer()
    const event = new testWindow.Event('dragstart', { bubbles: true }) as unknown as DragEvent
    Object.defineProperty(event, 'dataTransfer', { value: dt })
    await act(async () => { chip.dispatchEvent(event) })
    await mounted.unmount()
    expect(readEntityDragData(dt)?.ref).toBe('task:42')
    expect(readEntityDragData(dt)?.label).toBe('Release')
  })

  it('no entity component registers a drop target', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(import.meta.dir, '..')
    for (const file of readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name))) {
      const source = readFileSync(join(dir, file), 'utf8')
      expect({ file, drop: /onDrop|onDragOver|addEventListener\(['"]drop/.test(source) }).toEqual({ file, drop: false })
    }
  })
})
