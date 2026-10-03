import type { CapabilityRef } from '@rox/core/runtime-trace'
import type { BundledSkillPackStatus, LoadedSkill, LoadedSource, LlmConnectionWithStatus } from '../../shared/types'
import type { SkillUsageMap } from '@rox/shared/memory/types'

export const CAPABILITY_CATEGORIES = ['design', 'code', 'planning', 'knowledge', 'feedback', 'analytics', 'monitoring', 'communication', 'local', 'models', 'other'] as const
export type CapabilityCategory = typeof CAPABILITY_CATEGORIES[number]
export type CatalogStatus = 'available' | 'shadowed' | 'connected' | 'authenticated' | 'needs_auth' | 'failed' | 'untested' | 'local_disabled'
export interface CatalogCapability {
  key: string
  ref: CapabilityRef
  description: string
  categories: CapabilityCategory[]
  technicalType: 'skill' | 'mcp' | 'api' | 'local' | 'model'
  status: CatalogStatus
  requiredSources: string[]
  promptHits?: number
  lastPromptHit?: string
  author?: string
  updatedAt?: number
  usedInRun: boolean
  skill?: LoadedSkill
  source?: LoadedSource
  model?: LlmConnectionWithStatus
}

// Exact provider IDs are metadata, never an inference from a display name.
const PROVIDER_CATEGORIES: Readonly<Record<string, readonly CapabilityCategory[]>> = {
  figma: ['design'], chromatic: ['design'], storybook: ['design'], miro: ['design'], framer: ['design'],
  github: ['code'], gitlab: ['code'], bitbucket: ['code'], circleci: ['code'], vercel: ['code', 'monitoring'], netlify: ['code'],
  linear: ['planning'], jira: ['planning'], asana: ['planning'], trello: ['planning'], clickup: ['planning'], todoist: ['planning'],
  notion: ['knowledge'], confluence: ['knowledge'], 'google-drive': ['knowledge'], gdrive: ['knowledge'], coda: ['knowledge'], obsidian: ['knowledge'],
  intercom: ['feedback', 'communication'], zendesk: ['feedback'], gong: ['feedback'], typeform: ['feedback'], productboard: ['feedback', 'planning'],
  amplitude: ['analytics'], mixpanel: ['analytics'], 'google-analytics': ['analytics'], posthog: ['analytics'], metabase: ['analytics'], clickhouse: ['analytics'],
  sentry: ['monitoring'], datadog: ['monitoring'], pagerduty: ['monitoring'], grafana: ['monitoring'],
  slack: ['communication'], gmail: ['communication'], 'google-calendar': ['communication', 'planning'], 'microsoft-teams': ['communication'], teams: ['communication'], discord: ['communication'], zoom: ['communication'], telegram: ['communication'],
}
const SKILL_CATEGORIES: Readonly<Record<string, CapabilityCategory>> = {
  'design-critique': 'design', 'design-tokens': 'design', 'image-to-code': 'design', 'url-to-code': 'design',
  'react-best-practices': 'code', 'systematic-debugging': 'code', 'test-driven-development': 'code', 'requesting-code-review': 'code', 'receiving-code-review': 'code', 'using-git-worktrees': 'code',
  'writing-plans': 'planning', 'executing-plans': 'planning', orchestrate: 'planning', workflowz: 'planning',
  'google-docs': 'knowledge', 'notion-knowledge-capture': 'knowledge', 'notion-research-documentation': 'knowledge',
  'analyze-data-quality': 'analytics', 'visualize-data': 'analytics', 'build-dashboard': 'analytics', 'kpi-reporting': 'analytics',
}
// These shipped pack identifiers are verified in resources/skills/SKILLS.lock.
// A package's declared membership supplies category provenance for aliases.
const PACK_CATEGORIES: Readonly<Record<string, readonly CapabilityCategory[]>> = {
  superpowers: ['code', 'planning'], 'vercel-agent-skills': ['code', 'design'], 'vercel-next-skills': ['code'],
  'design-md': ['design'], impeccable: ['design'], 'ui-ux-pro-max': ['design'], 'shadcn-improve': ['design'],
  documents: ['knowledge'], 'obsidian-skills': ['knowledge'], 'rox-knowledge': ['knowledge'],
  'understand-anything': ['code', 'knowledge'], exa: ['knowledge'], last30days: ['knowledge'], gbrain: ['knowledge'],
  telegram: ['communication'], cua: ['local'], acpx: ['code'], 'agent-swarm': ['code', 'planning'],
  'compound-engineering': ['code'], gstack: ['code'], 'rox-harness': ['code', 'planning'],
  ultragoal: ['planning'], ultrathink: ['planning'], 'open-dynamic-workflows': ['planning'],
}
function validCategories(value: unknown): CapabilityCategory[] {
  return Array.isArray(value) ? value.filter((x): x is CapabilityCategory => typeof x === 'string' && (CAPABILITY_CATEGORIES as readonly string[]).includes(x)) : []
}
export function sourceCategories(source: LoadedSource): CapabilityCategory[] {
  const explicit = validCategories((source.config as LoadedSource['config'] & { categories?: unknown }).categories)
  if (explicit.length) return [...new Set(explicit)]
  if (source.config.type === 'local') return ['local']
  return [...(PROVIDER_CATEGORIES[source.config.provider.toLowerCase()] ?? ['other'])]
}
export function sourceCatalogStatus(source: LoadedSource, localMcpEnabled = true): CatalogStatus {
  const { config } = source
  if (config.enabled === false || (config.mcp?.transport === 'stdio' && !localMcpEnabled)) return 'local_disabled'
  const authType = config.mcp?.authType ?? config.api?.authType
  if (config.isAuthenticated === false || (authType && authType !== 'none' && config.isAuthenticated !== true)) return 'needs_auth'
  if (config.connectionStatus) return config.connectionStatus
  // Local file adapters have no remote authentication handshake. A saved API
  // credential alone, however, is not proof of a successful connection test.
  return config.type === 'local' ? 'connected' : 'untested'
}
export function capabilityCatalogKey(ref: CapabilityRef): string {
  return `${ref.kind}:${ref.scope}:${ref.id}`
}
export function buildCapabilityCatalog(options: {
  sources?: LoadedSource[]
  skills?: LoadedSkill[]
  packs?: BundledSkillPackStatus[]
  models?: LlmConnectionWithStatus[]
  usage?: SkillUsageMap | null
  usedCapabilities?: CapabilityRef[]
  localMcpEnabled?: boolean
}): CatalogCapability[] {
  const used = new Set(options.usedCapabilities?.map(capabilityCatalogKey))
  const rows: CatalogCapability[] = []
  for (const source of options.sources ?? []) {
    const ref: CapabilityRef = { kind: 'source', id: source.config.slug, scope: 'workspace', label: source.config.name }
    rows.push({ key: capabilityCatalogKey(ref), ref, description: source.config.tagline ?? source.config.provider, categories: sourceCategories(source), technicalType: source.config.type, status: sourceCatalogStatus(source, options.localMcpEnabled), requiredSources: [], updatedAt: source.config.updatedAt, usedInRun: used.has(capabilityCatalogKey(ref)), source })
  }
  for (const skill of options.skills ?? []) {
    const metadata = skill.metadata as LoadedSkill['metadata'] & { categories?: unknown; author?: unknown; updatedAt?: unknown }
    const explicit = validCategories(metadata.categories)
    const categorySlug = skill.slug.includes('--') ? skill.slug.split('--').at(-1)! : skill.slug
    const packCategories = options.packs?.filter(pack => pack.skills.includes(skill.slug)).flatMap(pack => PACK_CATEGORIES[pack.slug] ?? []) ?? []
    const categories: CapabilityCategory[] = explicit.length ? explicit : SKILL_CATEGORIES[categorySlug] ? [SKILL_CATEGORIES[categorySlug]!] : packCategories.length ? [...new Set(packCategories)] : ['other']
    const ref: CapabilityRef = { kind: 'skill', id: skill.slug, scope: skill.source, label: skill.metadata.name }
    // The historical counter records spawn-prompt mentions, not successful runs
    // or configured agent assignments. OMP/project counters are not fabricated.
    const usage = skill.source === 'workspace' ? options.usage?.[skill.slug] : undefined
    rows.push({ key: `${capabilityCatalogKey(ref)}:${skill.path}`, ref, description: metadata.description, categories, technicalType: 'skill', status: skill.shadowedByCraft ? 'shadowed' : 'available', requiredSources: metadata.requiredSources ?? [], promptHits: usage?.used, lastPromptHit: usage?.lastUsedAt || undefined, author: typeof metadata.author === 'string' ? metadata.author : undefined, updatedAt: typeof metadata.updatedAt === 'number' && Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : undefined, usedInRun: used.has(capabilityCatalogKey(ref)), skill })
  }
  for (const model of options.models ?? []) {
    const ref: CapabilityRef = { kind: 'model-connection', id: model.slug, scope: 'global', label: model.name }
    const expired = (model.oauthTimeRemainingMs !== undefined && model.oauthTimeRemainingMs <= 0)
      || (model.oauthExpiresAt !== undefined && model.oauthExpiresAt <= Date.now())
    const status: CatalogStatus = !model.isAuthenticated || expired ? 'needs_auth' : model.authError || model.oauthRefreshError ? 'failed' : 'authenticated'
    rows.push({ key: capabilityCatalogKey(ref), ref, description: model.defaultModel ?? model.providerType, categories: ['models'], technicalType: 'model', status, requiredSources: [], usedInRun: used.has(capabilityCatalogKey(ref)), model })
  }
  return rows
}
export function filterCapabilityCatalog(rows: CatalogCapability[], options: {
  query?: string
  category?: CapabilityCategory | 'all'
  technicalType?: CatalogCapability['technicalType'] | 'all'
  scope?: CapabilityRef['scope'] | 'all'
  connectedOnly?: boolean
}): CatalogCapability[] {
  const query = options.query?.trim().toLocaleLowerCase()
  return rows.filter(row => (!query || `${row.ref.label} ${row.ref.id} ${row.description} ${row.author ?? ''}`.toLocaleLowerCase().includes(query))
    && (!options.category || options.category === 'all' || row.categories.includes(options.category))
    && (!options.technicalType || options.technicalType === 'all' || row.technicalType === options.technicalType)
    && (!options.scope || options.scope === 'all' || row.ref.scope === options.scope)
    && (!options.connectedOnly || row.status === 'connected'))
}
export async function setCatalogPackEnabled(api: {
  setBundledSkillsDisabled: (disabled: string[]) => Promise<unknown>
  listBundledSkillPacks: () => Promise<BundledSkillPackStatus[]>
}, current: BundledSkillPackStatus[], slug: string, enabled: boolean): Promise<{ packs: BundledSkillPackStatus[]; failures: string[] }> {
  if (!current.some(pack => pack.slug === slug)) throw new Error('Unknown skill pack')
  // Read the global authority immediately before writing: other windows may
  // have toggled another pack since this catalog rendered.
  const before = await api.listBundledSkillPacks()
  const disabled = before.filter(pack => pack.disabled).map(pack => pack.slug)
  const next = enabled ? disabled.filter(id => id !== slug) : [...new Set([...disabled, slug])]
  await api.setBundledSkillsDisabled(next)
  const packs = await api.listBundledSkillPacks()
  const readback = packs.find(pack => pack.slug === slug)
  if (!readback || readback.disabled === enabled) throw new Error('Skill pack readback did not confirm the requested state')
  const failures = enabled ? [...(readback.error ? [readback.error] : []), ...readback.skills.filter(skill => !readback.installed.includes(skill))] : []
  return { packs, failures }
}
