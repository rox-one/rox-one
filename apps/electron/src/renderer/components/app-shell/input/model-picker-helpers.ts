import {
  isLocalConnection,
  getDefaultModelsForConnection,
  type LlmConnection,
} from '@config/llm-connections'
import { ROX_VISIBLE_TERMS } from '@craft-agent/shared/identity'
import type { ModelDefinition } from '@config/models'
import type { SessionModelCatalog, StartupRuntimeSummary } from '@craft-agent/shared/protocol'
import { connectionUsesBuiltInRoxModels, isRoxPublicModelId, isRoxLegacyInternalModelId, toRoxSelectableModelDefinitions } from '@craft-agent/shared/config/rox-public-models'

/** Older installs may still send the five bundled endpoints before startup migration runs. */
export function getConnectionModelsForPicker(connection: Pick<LlmConnection, 'slug' | 'name' | 'providerType' | 'models' | 'defaultModel' | 'baseUrl' | 'piAuthProvider'>): Array<string | ModelDefinition> {
  if (connectionUsesBuiltInRoxModels(connection)) {
    const customModels = (connection.models ?? []).filter((entry) => {
      const id = typeof entry === 'string' ? entry : entry.id
      return !isRoxPublicModelId(id) && !isRoxLegacyInternalModelId(id)
    })
    return [...toRoxSelectableModelDefinitions(), ...customModels]
  }
  return connection.models ?? getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider)
}

/** The native catalog is public configuration; it carries no credential readiness. */
export function getRuntimeModelsForPicker(summary: StartupRuntimeSummary | SessionModelCatalog, sessionConnection?: string): NonNullable<StartupRuntimeSummary['models']> {
  if (sessionConnection && sessionConnection !== summary.slug) return []
  return summary.models ?? []
}

/**
 * Format token count for display (e.g., 1500 -> "1.5k", 200000 -> "200k").
 * Shared by the desktop model dropdown and the compact (drawer) model picker.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`
  }
  return tokens.toString()
}

/**
 * Strip the "pi/" prefix from model IDs/display names so the user sees a
 * provider-agnostic label in the picker (e.g., "pi/claude-opus" → "claude-opus").
 */
export function stripPiPrefixForDisplay(value: string): string {
  return value.startsWith('pi/') ? value.slice(3) : value
}

export type ConnectionGroup = [groupName: string, connections: LlmConnection[]]

export function getConnectionIdentityLabel(connection: Pick<LlmConnection, 'oauthAccountEmail' | 'oauthOrganizationName'>): string | null {
  const parts = [connection.oauthOrganizationName, connection.oauthAccountEmail].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function getConnectionPickerMeta(connection: LlmConnection): string | null {
  return getConnectionIdentityLabel(connection)
}

/**
 * Group connections by provider type for hierarchical picker rendering.
 * Each provider section can contain multiple connections (API Key, OAuth, …).
 * Order is significant for UI: Anthropic, Rox, Local, Rox Backend.
 * Empty groups are dropped.
 */
export function groupConnectionsByProvider<T extends LlmConnection>(
  connections: readonly T[],
): Array<[string, T[]]> {
  const groups: Record<string, T[]> = {
    'Anthropic': [],
    [ROX_VISIBLE_TERMS.product]: [],
    'Local': [],
    'Rox Backend': [],
  }
  for (const conn of connections) {
    const provider = conn.providerType || 'anthropic'
    if (provider === 'anthropic' || provider === 'anthropic_compat') {
      groups['Anthropic'].push(conn)
    } else if (provider === 'omp') {
      groups[ROX_VISIBLE_TERMS.product].push(conn)
    } else if (provider === 'pi_compat' && isLocalConnection(conn)) {
      groups['Local'].push(conn)
    } else if (provider === 'pi' || provider === 'pi_compat') {
      groups['Rox Backend'].push(conn)
    }
  }
  return Object.entries(groups).filter(([, conns]) => conns.length > 0)
}
