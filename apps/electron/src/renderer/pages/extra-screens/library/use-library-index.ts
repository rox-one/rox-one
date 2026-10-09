/**
 * Cross-section index for «Библиотека». Loaded lazily — only once the user
 * engages the search field — so opening the screen never fans out to every
 * catalog. Section bodies load separately (React.lazy in LibraryPage).
 */
import { useEffect, useState } from 'react'
import { CAPABILITY_PACKS, CAPABILITY_TOOLS } from '@rox/shared/capabilities/packs'
import type { BundledSkillPackStatus, LoadedSkill, LoadedSource, LlmConnectionWithStatus } from '../../../../shared/types'
import {
  bundledPackEntries,
  marketplaceEntries,
  modelEntries,
  skillEntries,
  sourceEntries,
  type LibraryEntry,
} from './library-model'

export interface LibraryIndex {
  entries: LibraryEntry[]
  loading: boolean
}

export function useLibraryIndex(workspaceId: string, enabled: boolean): LibraryIndex {
  const [state, setState] = useState<LibraryIndex>({ entries: [], loading: false })

  useEffect(() => {
    if (!enabled || !workspaceId) return
    let stale = false
    setState({ entries: [], loading: true })
    const load = async () => {
      try {
        const [skills, sources, models, packs] = await Promise.all([
          window.electronAPI.getSkills(workspaceId).catch((): LoadedSkill[] => []),
          window.electronAPI.getSources(workspaceId).catch((): LoadedSource[] => []),
          window.electronAPI.listLlmConnectionsWithStatus().catch((): LlmConnectionWithStatus[] => []),
          window.electronAPI.listBundledSkillPacks().catch((): BundledSkillPackStatus[] => []),
        ])
        if (stale) return
        setState({
          entries: [
            ...skillEntries(skills),
            ...sourceEntries(sources),
            ...modelEntries(models),
            ...marketplaceEntries({
              packs: CAPABILITY_PACKS.map((pack) => ({ id: pack.id })),
              tools: CAPABILITY_TOOLS.map((tool) => ({ id: tool.id, title: tool.title, packId: tool.packId })),
            }),
            ...bundledPackEntries(packs),
          ],
          loading: false,
        })
      } catch {
        if (!stale) setState({ entries: [], loading: false })
      }
    }
    void load()
    return () => {
      stale = true
    }
  }, [workspaceId, enabled])

  return state
}