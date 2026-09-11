/**
 * Typed agent identity: generated default plus user-owned overrides.
 * Browser-safe — no filesystem imports.
 */

import { ROX_VISIBLE_TERMS } from './terms.ts'

export type AgentIdentitySource = 'generated' | 'user'

export interface AgentIdentity {
  name: string
  persona: string
  source: AgentIdentitySource
}

/** Persisted slice in preferences.json. */
export interface AgentIdentityRecord {
  name?: string
  persona?: string
  source?: AgentIdentitySource
}

export const DEFAULT_AGENT_SERIAL = 1

export function generateDefaultAgentIdentity(serial = DEFAULT_AGENT_SERIAL): AgentIdentity {
  const n = Number.isFinite(serial) && serial > 0 ? Math.floor(serial) : DEFAULT_AGENT_SERIAL
  return {
    name: `Agent Rox#${String(n).padStart(3, '0')}`,
    persona: '',
    source: 'generated',
  }
}

export function resolveAgentIdentity(stored?: AgentIdentityRecord | null): AgentIdentity {
  const generated = generateDefaultAgentIdentity()
  if (!stored) return generated

  const name = typeof stored.name === 'string' ? stored.name.trim() : ''
  const persona = typeof stored.persona === 'string' ? stored.persona.trim() : ''
  const explicitUser = stored.source === 'user'

  if (!name && !persona && !explicitUser) return generated

  if (explicitUser || (name && name !== generated.name) || persona) {
    return {
      name: name || generated.name,
      persona,
      source: 'user',
    }
  }

  return generated
}

/** User cleared both fields → generated default. Otherwise mark as user-owned. */
export function persistAgentIdentity(input: { name?: string | null; persona?: string | null }): AgentIdentity {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const persona = typeof input.persona === 'string' ? input.persona.trim() : ''
  if (!name && !persona) return generateDefaultAgentIdentity()
  return {
    name: name || generateDefaultAgentIdentity().name,
    persona,
    source: 'user',
  }
}

export function formatAgentIdentityForPrompt(identity: AgentIdentity): string {
  const lines = [
    '## Agent identity',
    `- Name: ${identity.name}`,
    `- Product: ${ROX_VISIBLE_TERMS.product}`,
    `- CLI: ${ROX_VISIBLE_TERMS.cli}`,
    `- Cloud: ${ROX_VISIBLE_TERMS.cloud}`,
  ]
  if (identity.persona) lines.push(`- Persona: ${identity.persona}`)
  lines.push(
    '- Runtime names (OMP, Pi, Craft, Hermes) are compatibility implementation metadata. Mention them only when the user asks for technical detail.',
    '',
  )
  return `${lines.join('\n')}\n`
}

export function formatSessionAgentLabel(identity: AgentIdentity): string {
  return identity.name
}

export function gitCoAuthorTrailer(identity: AgentIdentity): string {
  return `Co-Authored-By: ${identity.name} <agents-noreply@craft.do>`
}
