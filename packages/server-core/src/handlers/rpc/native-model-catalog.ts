import { getDefaultLlmConnection, getDefaultModelsForConnection, getLlmConnection, type LlmConnection } from '@rox/shared/config'
import { connectionUsesBuiltInRoxModels, isRoxLegacyInternalModelId, isRoxPublicModelId, toRoxSelectableModelDefinitions } from '@rox/shared/config/rox-public-models'
import { loadWorkspaceConfig } from '@rox/shared/workspaces'
import type { StartupRuntimeSummary } from '@rox/shared/protocol'
import { getWorkspaceOrThrow } from '@rox/server-core/handlers'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { readNativeConfigurationFile, readNativeConfigurationRegistry, readNativeWorkspaceRegistry } from './native-workspace-registry'

type RuntimeModelConnection = Pick<LlmConnection, 'slug' | 'name' | 'providerType' | 'baseUrl' | 'defaultModel' | 'models' | 'piAuthProvider'>

/** Only model-selection configuration is inspected; never use a migrating local getter. */
function nativeConnection(registry: Record<string, unknown> | null, slug: string): RuntimeModelConnection | null {
  if (!registry || !Array.isArray(registry.llmConnections)) return null
  const connection = registry.llmConnections.find(value => value && typeof value === 'object' && value.slug === slug) as Record<string, unknown> | undefined
  if (!connection || !['anthropic', 'pi', 'pi_compat', 'anthropic_compat', 'omp'].includes(String(connection.providerType))) return null
  return {
    slug, name: typeof connection.name === 'string' ? connection.name : '', providerType: connection.providerType as LlmConnection['providerType'],
    baseUrl: typeof connection.baseUrl === 'string' ? connection.baseUrl : undefined,
    defaultModel: typeof connection.defaultModel === 'string' ? connection.defaultModel : undefined,
    piAuthProvider: typeof connection.piAuthProvider === 'string' ? connection.piAuthProvider : undefined,
    models: Array.isArray(connection.models) ? connection.models.filter(value => typeof value === 'string' || value && typeof value === 'object' && typeof value.id === 'string') as LlmConnection['models'] : undefined,
  }
}

export function readNativeRuntimeConnection(slug: string): RuntimeModelConnection | null {
  return nativeConnection(readNativeConfigurationRegistry(), slug)
}

/** Resolve persisted selection without binding folders, seeding config or recovering journals. */
export function readNativeWorkspaceRuntimeConnection(workspaceId: string): RuntimeModelConnection | null {
  const workspace = readNativeWorkspaceRegistry(workspaceId)
  if (!workspace) return null
  try {
    const directory = lstatSync(workspace.rootPath)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return null
  } catch { return null }
  const registry = readNativeConfigurationRegistry()
  if (!registry) return null
  const config = readNativeConfigurationFile(join(workspace.rootPath, 'config.json'))
  const defaults = config?.defaults && typeof config.defaults === 'object' && !Array.isArray(config.defaults) ? config.defaults as Record<string, unknown> : null
  const first = Array.isArray(registry.llmConnections) ? registry.llmConnections[0] : undefined
  const slug = typeof defaults?.defaultLlmConnection === 'string' ? defaults.defaultLlmConnection
    : typeof registry.defaultLlmConnection === 'string' ? registry.defaultLlmConnection
    : first && typeof first === 'object' && typeof first.slug === 'string' ? first.slug : undefined
  return slug ? nativeConnection(registry, slug) : null
}

/** Resolve only the workspace-selected runtime; this performs no credential inspection. */
export function getWorkspaceRuntimeConnection(workspaceId: string): LlmConnection | null {
  const workspace = getWorkspaceOrThrow(workspaceId)
  const slug = loadWorkspaceConfig(workspace.rootPath)?.defaults?.defaultLlmConnection ?? getDefaultLlmConnection()
  return slug ? getLlmConnection(slug) ?? null : null
}

/** Public configuration only: never account names, URLs, auth status, or credentials. */
export function publicRuntimeSummary(connection: RuntimeModelConnection, includeModels: boolean): StartupRuntimeSummary {
  const summary: StartupRuntimeSummary = { kind: 'configuration-only', slug: connection.slug, providerType: connection.providerType, isDefault: true }
  if (!includeModels) return summary
  const builtInRox = connectionUsesBuiltInRoxModels(connection)
  const configuredModels = builtInRox ? [...toRoxSelectableModelDefinitions(), ...(connection.models ?? []).filter(model => {
    const id = typeof model === 'string' ? model : model.id
    return !isRoxPublicModelId(id) && !isRoxLegacyInternalModelId(id)
  })]
    : connection.models ?? getDefaultModelsForConnection(connection.providerType, connection.piAuthProvider)
  const safeId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(id) && !id.includes('://')
  const models = configuredModels.slice(0, 200).flatMap(model => {
    const id = typeof model === 'string' ? model : model.id
    if (!safeId(id)) return []
    const item: NonNullable<StartupRuntimeSummary['models']>[number] = { id, name: id }
    if (typeof model !== 'string') {
      if (typeof model.name === 'string' && model.name.length <= 200 && !/[\u0000-\u001f]/.test(model.name)) item.name = model.name
      if (typeof model.supportsThinking === 'boolean') item.supportsThinking = model.supportsThinking
      if (typeof model.contextWindow === 'number' && Number.isFinite(model.contextWindow) && model.contextWindow > 0) item.contextWindow = model.contextWindow
    }
    return [item]
  })
  const configuredDefault = builtInRox ? models[0]?.id : connection.defaultModel
  return { ...summary, models, defaultModel: safeId(configuredDefault) && models.some(model => model.id === configuredDefault) ? configuredDefault : models[0]?.id }
}
