/**
 * Honest model-fallback status (H3).
 *
 * Never invent a combo/fallback id. "Switched to X" only when the runtime
 * recorded an actual switch; otherwise the UI must say live-unverified.
 */

export type ModelFallbackStatus =
  | { kind: 'switched'; model: string }
  | { kind: 'unverified' }

export function resolveModelFallbackStatus(
  recorded: { switchedTo?: string | null } | null | undefined,
): ModelFallbackStatus {
  const model = recorded?.switchedTo?.trim()
  if (model) return { kind: 'switched', model }
  return { kind: 'unverified' }
}
