/**
 * Secondary navigation of the repo workspace (С-03 §B.3): one artifact kind per
 * surface. Tab labels double as surface headings, so no separate title keys are
 * introduced — every entry is a literal `devSpace.*` key.
 */
import type { DevSpaceManifestEntryKind } from '@rox/shared/dev-space'

export interface DevSpaceSurfaceDescriptor {
  /** Stable tab id (also the DOM test-id suffix). */
  readonly id: string
  /** Manifest entry kind this surface renders. */
  readonly kind: DevSpaceManifestEntryKind
  readonly labelKey: string
}

export const DEV_SPACE_SURFACES: readonly DevSpaceSurfaceDescriptor[] = [
  { id: 'wiki', kind: 'wiki', labelKey: 'devSpace.repo.tabs.wiki' },
  { id: 'understanding', kind: 'understanding', labelKey: 'devSpace.repo.tabs.understanding' },
  { id: 'graph', kind: 'code-graph', labelKey: 'devSpace.repo.tabs.graph' },
  { id: 'schemas', kind: 'diagram', labelKey: 'devSpace.repo.tabs.schemas' },
  { id: 'knowledgeGraph', kind: 'knowledge-graph', labelKey: 'devSpace.repo.tabs.knowledgeGraph' },
  { id: 'c4', kind: 'c4', labelKey: 'devSpace.repo.tabs.c4' },
]