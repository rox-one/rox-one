/**
 * Form-state persistence for ```openui blocks, kept out of the component so
 * its bounded-memory contract is unit-testable without mounting the vendor
 * renderer (writes happen on user interaction inside `@openuidev/react-ui`).
 */
// Module-level and bounded: at most FORM_STATE_CAP blocks keep their state,
// least-recently touched evicted first.
export const FORM_STATE_CAP = 32
const formStateStore = new Map<string, Record<string, unknown>>()

/**
 * Persistence key for a block's form state. Content-hash `blockId`s collide
 * across messages, so the owning scope disambiguates them.
 */
export function openUIFormStateKey(blockScope: string | undefined, blockId: string | undefined): string {
  return `${blockScope ?? ''}|${blockId ?? ''}`
}

/**
 * A non-null, non-array object — the shape both a form group and a field entry
 * take in the renderer's store.
 */
function isStoreRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * The renderer's store snapshot is `{field: {value, componentType}}`, but a
 * form submit wraps it once under the form name:
 * `{formName: {field: {value, componentType}}}` (vendor `getFormPayload`). The
 * follow-up message only needs the submitted `{field: value}` map, so a
 * form-named group is unwrapped one level; entries that already carry a
 * `value` (or scalars such as `$`-bindings) pass through.
 */
export function extractOpenUIFormValues(formState: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(formState)) {
    if (isStoreRecord(entry) && 'value' in entry) {
      values[key] = entry.value
    } else if (isStoreRecord(entry)) {
      for (const [field, fieldEntry] of Object.entries(entry)) {
        values[field] = isStoreRecord(fieldEntry) && 'value' in fieldEntry ? fieldEntry.value : fieldEntry
      }
    } else {
      values[key] = entry
    }
  }
  return values
}

export function readOpenUIFormState(blockId: string): Record<string, unknown> | undefined {
  const state = formStateStore.get(blockId)
  if (state === undefined) return undefined
  // Refresh recency (Map preserves insertion order).
  formStateStore.delete(blockId)
  formStateStore.set(blockId, state)
  return state
}

export function writeOpenUIFormState(blockId: string, state: Record<string, unknown>): void {
  formStateStore.delete(blockId)
  formStateStore.set(blockId, state)
  while (formStateStore.size > FORM_STATE_CAP) {
    const oldest = formStateStore.keys().next().value
    if (oldest === undefined) break
    formStateStore.delete(oldest)
  }
}