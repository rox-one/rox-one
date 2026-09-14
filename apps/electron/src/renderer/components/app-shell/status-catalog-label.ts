/**
 * Known catalog keys go through `t()` with no English `defaultValue`.
 * Catalog misses (`t()` returns the key or a non-string) use the user's
 * non-empty label when present, otherwise the identifier.
 * Never surface `status.<customId>` in the UI.
 */
export function statusCatalogLabel(
  t: (key: string) => unknown,
  state: { id: string; label?: string | null },
): string {
  const key = `status.${state.id}`
  const translated = t(key)
  if (typeof translated === 'string' && translated !== key) return translated
  if (typeof state.label === 'string' && state.label.trim() !== '') return state.label
  return state.id
}
