/**
 * W1-08 (#1505) — common row context-menu hook for entity chips and rows.
 *
 * `getEntityRowActions(ref)` returns `{ id, labelKey, run, disabled }` items.
 * The three defaults («Спросить @rox», «Закрепить», «Напомнить…») always
 * appear but stay disabled and inert until a later wave registers a handler
 * with `registerEntityRowActionHandler`. No orchestrator, rail or palette is
 * involved: the hook only lists actions.
 */
import type { EntityRef } from '@rox/core/entities'

export const DEFAULT_ENTITY_ROW_ACTIONS = [
  { id: 'ask-rox', labelKey: 'entities.ui.rowActions.askRox' },
  { id: 'pin', labelKey: 'entities.ui.rowActions.pin' },
  { id: 'remind', labelKey: 'entities.ui.rowActions.remind' },
] as const

export type DefaultEntityRowActionId = (typeof DEFAULT_ENTITY_ROW_ACTIONS)[number]['id']

export interface EntityRowAction {
  id: string
  labelKey: string
  /** No-op when `disabled`. */
  run: () => void | Promise<void>
  disabled: boolean
}

export interface EntityRowActionHandler {
  run: (ref: EntityRef) => void | Promise<void>
  /** Optional per-ref availability (e.g. kinds that cannot be pinned). */
  isAvailable?: (ref: EntityRef) => boolean
  /** Label key for actions that are not one of the defaults. */
  labelKey?: string
}

const handlers = new Map<string, EntityRowActionHandler>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** Register (or replace) the handler for an action id. Returns an unregister function. */
export function registerEntityRowActionHandler(id: string, handler: EntityRowActionHandler): () => void {
  if (!id.trim()) throw new Error('Entity row action id must not be empty')
  const isDefault = DEFAULT_ENTITY_ROW_ACTIONS.some((action) => action.id === id)
  if (!isDefault && !handler.labelKey) throw new Error(`Entity row action "${id}" needs a labelKey`)
  handlers.set(id, handler)
  emit()
  return () => {
    if (handlers.get(id) === handler) {
      handlers.delete(id)
      emit()
    }
  }
}

export function subscribeEntityRowActions(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test helper: drop every registered handler. */
export function resetEntityRowActionHandlers(): void {
  handlers.clear()
  emit()
}

const noop = () => {}

export function getEntityRowActions(ref: EntityRef): EntityRowAction[] {
  const actions: EntityRowAction[] = DEFAULT_ENTITY_ROW_ACTIONS.map(({ id, labelKey }) => {
    const handler = handlers.get(id)
    const enabled = !!handler && (handler.isAvailable?.(ref) ?? true)
    return { id, labelKey, disabled: !enabled, run: enabled ? () => handler!.run(ref) : noop }
  })
  for (const [id, handler] of handlers) {
    if (DEFAULT_ENTITY_ROW_ACTIONS.some((action) => action.id === id)) continue
    if (handler.isAvailable && !handler.isAvailable(ref)) continue
    actions.push({ id, labelKey: handler.labelKey!, disabled: false, run: () => handler.run(ref) })
  }
  return actions
}
