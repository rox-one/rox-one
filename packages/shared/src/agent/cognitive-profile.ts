/**
 * Host-provided `<user_cognitive_profile>` injection into the OMP agent system
 * context.
 *
 * The block is derived from third-party web content (browsing history, page
 * text), so it is untrusted input being placed inside a system prompt. Two
 * consequences drive this module:
 *
 * 1. `@rox/browser-intel` depends on `@rox/shared`, so `@rox/shared` MUST NOT
 *    import it. The producing side registers a provider through this
 *    process-wide registry (same shape as `setOwnedRootAdapter` in
 *    `config/owned-root-policy.ts`); the consumer (OMP spawn) only reads.
 * 2. Every value is sanitized at read time — the provider is untrusted too, and
 *    sanitizing per call (rather than caching) means a provider swap can never
 *    leak a stale block into the next spawn prompt.
 */

const OPEN_TAG = '<user_cognitive_profile>';
const CLOSE_TAG = '</user_cognitive_profile>';

/** Longest single line allowed through; longer lines are fingerprinting/noise. */
const MAX_LINE_LENGTH = 400;

/** Total block budget (characters), inclusive of the wrapper tags. */
const MAX_BLOCK_LENGTH = 8000;

type CognitiveProfileProvider = () => string | null;

let provider: CognitiveProfileProvider | null = null;

/**
 * Install (or clear) the process-wide producer of the raw cognitive-profile
 * block. Passing `null` disables injection. The provider is called lazily on
 * every {@link getCognitiveProfileBlock}.
 */
export function setCognitiveProfileProvider(next: CognitiveProfileProvider | null): void {
  provider = next;
}

/** Restore the disabled state. Test seam — production registers a provider once. */
export function resetCognitiveProfileProvider(): void {
  provider = null;
}

/**
 * Read the current profile through the registered provider and sanitize it.
 * Never throws: a failing or absent provider yields `null`, which the caller
 * treats as "no injection".
 */
export function getCognitiveProfileBlock(): string | null {
  if (!provider) return null;
  let raw: string | null;
  try {
    raw = provider();
  } catch {
    // Untrusted producer: a failure must not abort the spawn.
    return null;
  }
  return sanitizeCognitiveProfileBlock(raw);
}

function stripControlCharacters(text: string): string {
  // Keep \n and \t (structure), drop every other C0/C1 control char (including \r).
  return text.replace(/[\u0000-\u0008\u000B-\u000D\u000E-\u001F\u007F-\u009F]/g, '');
}

function collapseBlankLines(text: string): string {
  // Runs of 3+ newlines collapse to a single blank line.
  return text.replace(/\n{3,}/g, '\n\n');
}

function dropOverlongLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.length <= MAX_LINE_LENGTH)
    .join('\n');
}

function ensureWrapper(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith(OPEN_TAG) && trimmed.endsWith(CLOSE_TAG)) return trimmed;
  return `${OPEN_TAG}\n${trimmed}\n${CLOSE_TAG}`;
}

/**
 * Enforce the safety contract before untrusted text can reach a system prompt.
 * Returns `null` when nothing usable survives.
 */
export function sanitizeCognitiveProfileBlock(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  let text = stripControlCharacters(raw);
  text = dropOverlongLines(text);
  text = collapseBlankLines(text);

  if (!text.trim()) return null;

  text = ensureWrapper(text);

  if (text.length > MAX_BLOCK_LENGTH) {
    // Truncate the body, not the wrapper: cutting the whole string would drop
    // the closing tag and leave following prompt blocks ambiguously inside an
    // unclosed element. Reserve room for the tags, the ellipsis marker, and the
    // two wrapper newlines, then cut on a line boundary.
    const inner = text.slice(OPEN_TAG.length, text.length - CLOSE_TAG.length);
    const budget = MAX_BLOCK_LENGTH - OPEN_TAG.length - CLOSE_TAG.length - 3;
    const head = inner.slice(0, budget);
    const lastBreak = head.lastIndexOf('\n');
    const cut = lastBreak > 0 ? head.slice(0, lastBreak) : head;
    text = `${OPEN_TAG}\n${cut.trimEnd()}…\n${CLOSE_TAG}`;
  }

  return text;
}