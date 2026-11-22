/**
 * CSV as the staff panel downloads it: UTF-8 with a byte-order mark so Excel
 * reads Russian, CRLF line ends, and RFC 4180 quoting. The file is built from
 * the rows already on screen, so a filter and its export always agree.
 */
export type CsvValue = string | number | null | undefined

function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvText(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','))
  return `\ufeff${lines.join('\r\n')}\r\n`
}

export function downloadCsv(
  name: string,
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
): void {
  const blob = new Blob([csvText(header, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** `2026-11-22` in the operator's own time zone, for a file name. */
export function dateStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
