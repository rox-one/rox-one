import type { RoadmapAiResponse } from '@craft-agent/shared/projects/roadmap-ai'

/** Display only effective provenance returned by the authenticated RPC. */
export function RoadmapModelResult({ result, t }: {
  result: RoadmapAiResponse | null
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (!result) return null
  return (
    <div className="mt-1 px-1 text-[11px] text-muted-foreground" data-testid="project-ai-result-provenance">
      <p data-testid="project-ai-effective-model">{typeof result.effectiveModel === 'string'
        ? t('projectRoadmap.ai.effectiveKnown', { model: result.effectiveModel })
        : t('projectRoadmap.ai.effectiveUnknown')}</p>
      {result.requestedModel ? <p>{t('projectRoadmap.ai.requestedModel', { model: result.requestedModel })}</p> : null}
      {result.warning ? <p role="status" data-testid="project-ai-backend-warning">{result.warning}</p> : null}
    </div>
  )
}
