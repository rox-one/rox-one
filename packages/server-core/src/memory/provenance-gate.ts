/**
 * provenance-gate — the origin-class gate for memory recall (spec c1.2).
 *
 * `MemoryChunkProvenance.originClass` is stamped when a chunk enters the index,
 * derived from the producing session kind. The class is the single authority
 * for injection: retrieval (`memory:search` / `memory_search`) returns every
 * chunk regardless of origin, but automatic prompt injection only ever admits
 * `owner` and `agent` chunks. `untrusted` content stays retrievable and is
 * labelled — it can be shown to a human, never slipped into the prompt.
 *
 * The classification is deliberately not parsed from Markdown: the agent can
 * write any prose it likes, so trust must come from the writer's identity, not
 * from the document body.
 */
import type { MemoryChunkProvenance, MemoryOriginClass, MemorySessionKind } from '@rox/shared/memory/types'

/**
 * Map a producing session kind to an origin class.
 *
 * - `interactive` sessions are human-directed → `owner`.
 * - `subagent`/`cron`/`heartbeat` work is the agent acting on its own → `agent`.
 * - `unknown` cannot be vouched for → `untrusted` (the safe default: never
 *   injected).
 *
 * `opts.system` forces `system` for curated/machine-authored seeds; `opts.explicitOwner`
 * forces `owner` for content the user wrote directly (e.g. an explicit lesson add).
 */
export function classifyMemoryOrigin(
  sessionKind: MemorySessionKind,
  opts?: { system?: boolean; explicitOwner?: boolean },
): MemoryOriginClass {
  if (opts?.system) return 'system'
  if (opts?.explicitOwner) return 'owner'
  switch (sessionKind) {
    case 'interactive':
      return 'owner'
    case 'subagent':
    case 'cron':
    case 'heartbeat':
      return 'agent'
    case 'unknown':
    default:
      return 'untrusted'
  }
}

/** Stamp a provenance record from a producing session kind. */
export function memoryProvenanceFor(
  sessionKind: MemorySessionKind,
  observedAt: string,
  opts?: { system?: boolean; explicitOwner?: boolean; supersedesKey?: string },
): MemoryChunkProvenance {
  const provenance: MemoryChunkProvenance = {
    originClass: classifyMemoryOrigin(sessionKind, opts),
    sessionKind,
    observedAt,
  }
  if (opts?.supersedesKey) provenance.supersedesKey = opts.supersedesKey
  return provenance
}

/**
 * The injection gate. Only `owner` and `agent` chunks may enter a prompt
 * automatically. `untrusted` (retrievable-but-labelled) and `system`
 * (curated, human-facing) are excluded from automatic injection.
 */
export function isMemoryOriginEligibleForAutomaticInjection(origin: MemoryOriginClass | undefined | null): boolean {
  return origin === 'owner' || origin === 'agent'
}