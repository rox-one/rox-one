/**
 * ROX Drive — operator env-file reader.
 *
 * The packaged desktop app never sees the shell environment, so the S3 target
 * (`ROX_DRIVE_S3_*`) can also be supplied through a `KEY=VALUE` file the
 * operator writes next to the config dir: `<configDir>/drive-s3.env` (the same
 * format as `~/.config/rox/drive-s3.env`).
 *
 * The parser is deliberately small and dependency-free: one `KEY=VALUE` pair
 * per line, `#` comments and blank lines ignored, one layer of matching single
 * or double quotes stripped from the value, and a leading `export ` tolerated
 * so the file can be sourced by a shell as well. Later duplicates win.
 */
import { readFileSync } from 'node:fs'

/**
 * Parses `KEY=VALUE` text into a record. Malformed lines (no `=`, empty key)
 * are skipped rather than throwing, so a partially written operator file still
 * yields whatever it does define.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()
    const separator = line.indexOf('=')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    if (key === '') continue
    let value = line.slice(separator + 1).trim()
    const quote = value[0]
    if (value.length >= 2 && (quote === '"' || quote === "'") && quote === value[value.length - 1]) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

/** Reads and parses an env file; a missing or unreadable file yields `{}`. */
export function loadEnvFile(path: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  return parseEnvFile(text)
}