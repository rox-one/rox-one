/**
 * RMA-I028 / #384 — adversarial policy helpers for meeting agents.
 * Actor comes from authenticated RPC, never the body. Transcript text cannot mint authority.
 */

export type AuthenticatedActor = {
  readonly actorId: string
  readonly workspaceId: string
}

export type SecurityDecision = 'allow' | 'deny'

export function actorFromRpc(rpcActor: AuthenticatedActor, bodyActorId?: string): AuthenticatedActor {
  void bodyActorId
  return rpcActor
}

export function allowToolFromTranscript(instruction: string, allowlist: readonly string[]): SecurityDecision {
  const lowered = instruction.toLowerCase()
  if (allowlist.some((tool) => lowered.includes(tool))) return 'deny'
  return 'deny'
}

export function includePrivateNoteInRecap(privateNote: string, audience: readonly string[]): SecurityDecision {
  void privateNote
  return audience.length === 0 ? 'deny' : 'deny'
}

export function searchAcrossWorkspaces(
  actor: AuthenticatedActor,
  queryWorkspaceId: string,
): SecurityDecision {
  return actor.workspaceId === queryWorkspaceId ? 'allow' : 'deny'
}

export function retrieveSecretFromPrompt(text: string): SecurityDecision {
  if (/api[_-]?key|password|secret|token/i.test(text)) return 'deny'
  return 'deny'
}

export function staleConsent(grantedAt: number, now: number, ttlMs: number): SecurityDecision {
  return now - grantedAt > ttlMs ? 'deny' : 'allow'
}

export function approveThenRevoke(approved: boolean, revoked: boolean): SecurityDecision {
  if (revoked) return 'deny'
  return approved ? 'allow' : 'deny'
}
