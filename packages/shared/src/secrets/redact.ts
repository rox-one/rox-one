/**
 * Secret redaction utility.
 *
 * `redactSecrets` masks known resolved secret values in arbitrary text
 * (logs, diagnostics). The process-wide registry lets the secrets module's
 * own logging redact every value it has resolved without threading the
 * value list through every call site.
 *
 * Values shorter than MIN_REDACTABLE_LENGTH are never masked: replacing a
 * 1–3 char string would corrupt unrelated text.
 */

export const REDACTED_PLACEHOLDER = '***REDACTED***';

const MIN_REDACTABLE_LENGTH = 4;

function redactable(values: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value === 'string' && value.length >= MIN_REDACTABLE_LENGTH) {
      unique.add(value);
    }
  }
  // Longest first so a value that is a prefix of another doesn't leave
  // partial fragments behind.
  return [...unique].sort((a, b) => b.length - a.length);
}

/** Mask every occurrence of each known secret value in `text`. */
export function redactSecrets(text: string, values: Iterable<string>): string {
  let out = text;
  for (const value of redactable(values)) {
    // split/join: literal replacement, no regex metacharacter hazards.
    out = out.split(value).join(REDACTED_PLACEHOLDER);
  }
  return out;
}

const registry = new Set<string>();

/** Add resolved values to the process-wide redaction registry. */
export function registerSecretValues(values: Iterable<string>): void {
  for (const value of redactable(values)) {
    registry.add(value);
  }
}

/** Mask all registered secret values in `text`. */
export function redactRegisteredSecrets(text: string): string {
  return redactSecrets(text, registry);
}

/** Empty the registry. Primarily for tests. */
export function clearRegisteredSecretValues(): void {
  registry.clear();
}
