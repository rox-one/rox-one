/** Unified line diff of selected historical body vs current editor text (preview only). */
export function previewDiff(current: string, historical: string): Array<{ type: 'same' | 'add' | 'del'; text: string }> {
  const a = current.split('\n')
  const b = historical.split('\n')
  const rows: Array<{ type: 'same' | 'add' | 'del'; text: string }> = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i]! })
      i += 1
      j += 1
      continue
    }
    if (j < b.length && (i >= a.length || !a.slice(i, i + 3).includes(b[j]!))) {
      rows.push({ type: 'add', text: b[j]! })
      j += 1
      continue
    }
    if (i < a.length) {
      rows.push({ type: 'del', text: a[i]! })
      i += 1
    }
  }
  return rows
}
