/**
 * W1-11 (#1508) — The `@rox` handle-resolution contract (DATA-MODEL §5.12,
 * PRD D-v2-5; TECH-SPEC §13.7).
 *
 * `@rox` is a **contextual alias**: in a chat, doc or comment it resolves to
 * the *author's own* personal agent, and the stored mention is the concrete
 * `person:<agent_principal_id>`. Another person's agent is addressed with the
 * explicit handle `@rox-<username>`, shown in the picker as «Rox · Имя».
 *
 * Resolution is pure: the caller supplies the bindings it can see (W1-04's
 * directory read model), and gets back the agent principal or `null`.
 */

import { AGENT_DISPLAY_NAME, AGENT_HANDLE_ALIAS } from '../agents/governance.ts'

export { AGENT_DISPLAY_NAME }

/** The global alias every agent answers to. */
export const AGENT_HANDLE_ROOT = AGENT_HANDLE_ALIAS

/** The handle a personal agent is provisioned with (the disambiguated form is derived). */
export const PERSONAL_AGENT_HANDLE = AGENT_HANDLE_ROOT

/** `@rox`, `@rox-maria`, … — the trailing part is the owner's username. */
export const AGENT_MENTION_PATTERN = /@rox(?:-([a-z0-9][a-z0-9._-]{0,63}))?/gi

export interface ParsedAgentMention {
  /** `self` = the bare `@rox` alias (the author's agent). */
  kind: 'self' | 'username'
  username?: string
  /** The literal text that was matched, for replacing it with a mention node. */
  raw: string
}

export interface AgentHandleBinding {
  agentPrincipalId: string
  ownerPrincipalId: string
  /** Global alias (`rox`). */
  handle: string
  /** Disambiguated display handle (`rox-<owner-username>`). */
  displayHandle: string
  displayName: string
  /** Owner's username, used to address this agent explicitly. */
  username?: string | null
  /** Binding status; a paused or revoked agent is never resolved (§13.2 step 1). */
  status?: 'active' | 'paused' | 'revoked'
}

/** Every `@rox…` mention in a text, in order. */
export function parseAgentMentions(text: string): ParsedAgentMention[] {
  const mentions: ParsedAgentMention[] = []
  const pattern = new RegExp(AGENT_MENTION_PATTERN.source, AGENT_MENTION_PATTERN.flags)
  for (const match of text.matchAll(pattern)) {
    const username = match[1]
    mentions.push(username ? { kind: 'username', username: username.toLowerCase(), raw: match[0] } : { kind: 'self', raw: match[0] })
  }
  return mentions
}

/** One `@rox…` mention, or `null` when the text is not a mention. */
export function parseAgentMention(mention: string): ParsedAgentMention | null {
  const [first] = parseAgentMentions(mention)
  return first && first.raw === mention ? first : first ?? null
}

export interface ResolveAgentMentionInput {
  mention: ParsedAgentMention | string
  /** The principal who wrote the mention. */
  authorPrincipalId: string
  /** Bindings visible to the author (their own agent is always among them). */
  bindings: readonly AgentHandleBinding[]
}

/**
 * Resolve a mention to an agent principal. `@rox` never resolves to someone
 * else's agent, and `@rox-<username>` never resolves to the author's own
 * unless the username matches. A paused / revoked agent does not resolve.
 */
export function resolveAgentMention(input: ResolveAgentMentionInput): AgentHandleBinding | null {
  const mention = typeof input.mention === 'string' ? parseAgentMention(input.mention) : input.mention
  if (!mention) return null
  const live = input.bindings.filter(binding => (binding.status ?? 'active') === 'active')
  if (mention.kind === 'self') {
    return live.find(binding => binding.ownerPrincipalId === input.authorPrincipalId) ?? null
  }
  const username = mention.username
  if (!username) return null
  return live.find(binding => binding.displayHandle.toLowerCase() === `${AGENT_HANDLE_ROOT}-${username}`)
    ?? live.find(binding => (binding.username ?? '').toLowerCase() === username)
    ?? null
}

/**
 * The ref stored in a mention: always the concrete agent principal, never the
 * alias (§5.12). `person` is one of the 21 ROX2 kinds.
 */
export function agentMentionRef(agentPrincipalId: string): { kind: 'person'; id: string } {
  return { kind: 'person', id: agentPrincipalId }
}

/** The disambiguated handle shown in the picker as `@rox-<username>`. */
export function agentDisplayHandle(username: string): string {
  return `${AGENT_HANDLE_ROOT}-${username.toLowerCase()}`
}

/** «Rox» to the owner, «Rox · Марк» to everyone else (§5.12). */
export function agentDisplayName(ownerDisplayName?: string | null): string {
  return ownerDisplayName ? `${AGENT_DISPLAY_NAME} · ${ownerDisplayName}` : AGENT_DISPLAY_NAME
}

/**
 * Guests and non-members may not add an agent to a chat (§5.12): mentioning an
 * agent that is not a member adds it as a guest bot only when the author may
 * add members; otherwise the agent replies in the author's DM.
 */
export function agentCanJoinThread(input: { authorIsMember: boolean; authorCanAddMembers: boolean }): 'guest_bot' | 'dm_reply' {
  return input.authorIsMember && input.authorCanAddMembers ? 'guest_bot' : 'dm_reply'
}