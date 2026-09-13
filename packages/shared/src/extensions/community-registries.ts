/**
 * Community catalog registries (P35-06).
 *
 * Stub sources with public docs URLs only — never ship live tokens or
 * scrape credentials. list() is empty until a later connector slice.
 */

import type { CatalogProvider, ExtensionPackage } from './catalog.ts'
import type { CatalogEntry, CatalogFilter, ExtensionProviderId } from './types.ts'

export interface CommunityRegistryDef {
  id: Extract<
    ExtensionProviderId,
    | 'community-anthropic'
    | 'community-codex'
    | 'community-cursor'
    | 'community-hermes'
    | 'community-opencode'
    | 'community-openclaw'
  >
  label: string
  docsUrl: string
}

/** Public docs only. Do not add API tokens or live registry endpoints here. */
export const COMMUNITY_EXTENSION_REGISTRIES: readonly CommunityRegistryDef[] = [
  {
    id: 'community-anthropic',
    label: 'Anthropic',
    docsUrl: 'https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview',
  },
  {
    id: 'community-codex',
    label: 'Codex',
    docsUrl: 'https://developers.openai.com/codex',
  },
  {
    id: 'community-cursor',
    label: 'Cursor',
    docsUrl: 'https://cursor.com/docs',
  },
  {
    id: 'community-hermes',
    label: 'Hermes',
    docsUrl: 'https://github.com/NousResearch/Hermes-Agent',
  },
  {
    id: 'community-opencode',
    label: 'OpenCode',
    docsUrl: 'https://opencode.ai/docs',
  },
  {
    id: 'community-openclaw',
    label: 'OpenClaw',
    docsUrl: 'https://docs.openclaw.ai',
  },
] as const

export class CommunityStubProvider implements CatalogProvider {
  readonly id: CommunityRegistryDef['id']
  readonly label: string
  readonly docsUrl: string
  readonly community = true as const

  constructor(def: CommunityRegistryDef) {
    this.id = def.id
    this.label = def.label
    this.docsUrl = def.docsUrl
  }

  async list(_filter?: CatalogFilter): Promise<CatalogEntry[]> {
    return []
  }

  async fetch(_id: string, _version: string): Promise<ExtensionPackage | null> {
    return null
  }
}

export function createCommunityRegistryProviders(): CommunityStubProvider[] {
  return COMMUNITY_EXTENSION_REGISTRIES.map((def) => new CommunityStubProvider(def))
}
