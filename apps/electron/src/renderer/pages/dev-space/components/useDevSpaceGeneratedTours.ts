import { useEffect, useState } from 'react'
import type { DevSpaceArtifactSummary } from '@rox/shared/dev-space'
import { registerDynamicTour } from '@/features/product-tour/runtime'
import { parseDevSpaceTourDefinition, type DevSpaceGeneratedTour } from './questions'

/**
 * Read the `tour` artifacts of one repo, admit them into the product-tour
 * dynamic catalogue (`registerDynamicTour`, D9) and expose the ids the С-10
 * surface launches.
 *
 * Registration is the same public seam the tour engine resolves `start(id)`
 * against, so a tour offered here is exactly a tour the runtime can run.
 * Invalid definitions are rejected by the registry and never offered; the
 * cleanup is token-fenced, so a replacement registration is not removed by a
 * stale unmount.
 */
export function useDevSpaceGeneratedTours(
  workspaceId: string | null,
  projectSlug: string | null,
  artifacts: readonly DevSpaceArtifactSummary[],
): readonly DevSpaceGeneratedTour[] {
  const [tours, setTours] = useState<readonly DevSpaceGeneratedTour[]>([])
  useEffect(() => {
    const entries = artifacts.filter((artifact) => artifact.kind === 'tour')
    if (!workspaceId || !projectSlug || entries.length === 0) { setTours([]); return }
    let current = true
    const cleanups: Array<() => void> = []
    void Promise.all(entries.map(async (entry) => {
      const result = await window.electronAPI.readDevSpaceArtifact({ workspaceId, projectSlug, artifactId: entry.id })
      return result.encoding === 'utf8' ? parseDevSpaceTourDefinition(result.content) : null
    })).then((definitions) => {
      const admitted: DevSpaceGeneratedTour[] = []
      const admittedCleanups: Array<() => void> = []
      for (const definition of definitions) {
        if (!definition) continue
        const registration = registerDynamicTour(definition)
        if (registration.id === null) continue
        admittedCleanups.push(registration.cleanup)
        admitted.push({ id: registration.id, targets: definition.steps.map((step) => step.target) })
      }
      // A stale resolve must not leak registrations into the shared catalogue.
      if (!current) { for (const cleanup of admittedCleanups) cleanup(); return }
      cleanups.push(...admittedCleanups)
      setTours(admitted)
    }).catch(() => { if (current) setTours([]) })
    return () => { current = false; for (const cleanup of cleanups) cleanup() }
  }, [workspaceId, projectSlug, artifacts])
  return tours
}