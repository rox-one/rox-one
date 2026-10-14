/**
 * Главная write actions on personal tasks. Same path as the Задачи screen and
 * reminders: load the store, mutate, persist (local cache + native sync).
 */
import { loadPersonalTaskStore, persistPersonalTaskStore } from '@/lib/personal-tasks'

export function setPersonalTaskDone(id: string, done: boolean, now = Date.now()): boolean {
  const store = loadPersonalTaskStore()
  if (!store.get(id)) return false
  if (done) store.complete(id, now)
  else store.reopen(id)
  persistPersonalTaskStore(store)
  return true
}

/** Apply new manual `order` values (see `reorderedSlots`). */
export function setPersonalTaskOrders(orders: ReadonlyMap<string, number>): boolean {
  if (orders.size === 0) return false
  const store = loadPersonalTaskStore()
  let changed = false
  for (const [id, order] of orders) {
    if (!store.get(id)) continue
    store.update(id, { order })
    changed = true
  }
  if (changed) persistPersonalTaskStore(store)
  return changed
}
