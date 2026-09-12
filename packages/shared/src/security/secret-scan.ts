/**
 * Secret / log / artifact scan (Issue 34).
 * Detects credential-shaped values so tests and release checks fail closed.
 * Never logs the matched value.
 */

const PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'pem-private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-pat', pattern: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { id: 'generic-bearer', pattern: /\bBearer\s+[A-Za-z0-9._\-+=/]{20,}\b/ },
]

export interface SecretScanFinding {
  id: string
  /** Character offset only — never the secret text. */
  at: number
}

export function scanTextForSecrets(text: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = []
  for (const rule of PATTERNS) {
    const copy = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`)
    let match: RegExpExecArray | null
    while ((match = copy.exec(text)) !== null) {
      findings.push({ id: rule.id, at: match.index })
    }
  }
  return findings
}

export function assertNoSecretsInArtifact(text: string, label = 'artifact'): void {
  const findings = scanTextForSecrets(text)
  if (findings.length === 0) return
  const ids = [...new Set(findings.map((f) => f.id))].join(', ')
  throw new Error(`${label} contains credential-shaped material (${ids})`)
}
