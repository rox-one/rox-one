/**
 * Shared identifier redaction for recap/export/audit (I028 leftover).
 * W2 / SSN values never leave a sanitized shared surface.
 */

export {
  containsSensitiveIdentifier,
} from '@craft-agent/shared/meeting-agents'

export function redactSensitiveIdentifiers(text: string): string {
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-id]').replace(/\bW-?2\b/gi, '[redacted]')
}
