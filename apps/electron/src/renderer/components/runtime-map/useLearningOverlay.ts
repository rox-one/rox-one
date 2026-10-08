import * as React from 'react'
import { loadLearningMapInput } from './learning-overlay'
import type { LearningMapInput } from './learning-nodes'

/**
 * Live learning source for the runtime map (PRD §30).
 *
 * Fail-soft by contract: an absent API, an `UNSUPPORTED_OPERATION` host or a
 * failed read yields `undefined`, so `learningOverlay(undefined)` adds nothing
 * to the map and no error surfaces.
 */
export function useLearningOverlay(workspaceId: string | undefined): LearningMapInput | undefined {
  const [input, setInput] = React.useState<LearningMapInput>()
  React.useEffect(() => {
    let active = true
    setInput(undefined)
    loadLearningMapInput(workspaceId).then(
      next => { if (active) setInput(next) },
      () => { if (active) setInput(undefined) },
    )
    return () => { active = false }
  }, [workspaceId])
  return input
}