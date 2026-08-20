/**
 * Parse g2-decision-record.md. Managed spawn is allowed only when ACCEPTED + variant C.
 */
import { readFileSync } from 'node:fs'

export function readG2AcceptedVariant(markdown: string): 'C' | 'B' | null {
  const statusAccepted = /\*\*Status:\s*ACCEPTED\*\*/i.test(markdown)
  if (!statusAccepted) return null
  if (/\bvariant\s*C\b/i.test(markdown) || /\bC\s*[—-]\s*OEM/i.test(markdown)) return 'C'
  if (/\bvariant\s*B\b/i.test(markdown)) return 'B'
  return null
}

/** Reads G2_RECORD_PATH when set. Missing/unreadable → null (fail-closed). */
export function loadG2AcceptedVariantFromDisk(path: string | undefined = process.env.G2_RECORD_PATH): 'C' | 'B' | null {
  if (!path) return null
  try {
    return readG2AcceptedVariant(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
