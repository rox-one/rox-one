import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoadmapModelResult } from '../RoadmapModelResult'

const t = (key: string, options?: Record<string, unknown>) => `${key}${options?.model ? `:${options.model}` : ''}`

test('actual result UI separates requested model, unknown effective model and escaped backend warning', () => {
  const html = renderToStaticMarkup(<RoadmapModelResult t={t} result={{
    ok: true, mode: 'improve', text: 'Proposal', requestedModel: 'requested-fixture',
    effectiveModel: null, warning: '<backend fallback warning>',
  }} />)
  expect(html).toContain('projectRoadmap.ai.effectiveUnknown')
  expect(html).toContain('projectRoadmap.ai.requestedModel:requested-fixture')
  expect(html).toContain('&lt;backend fallback warning&gt;')
  expect(html).not.toContain('projectRoadmap.ai.effectiveKnown:requested-fixture')
})

test('actual result UI shows only explicitly returned effective model and retains failure warning', () => {
  const known = renderToStaticMarkup(<RoadmapModelResult t={t} result={{
    ok: true, mode: 'clarify', questions: ['Fixture?'], requestedModel: 'requested-fixture',
    effectiveModel: 'actual-fixture',
  }} />)
  expect(known).toContain('projectRoadmap.ai.effectiveKnown:actual-fixture')
  expect(known).not.toContain('projectRoadmap.ai.effectiveUnknown')
  const failed = renderToStaticMarkup(<RoadmapModelResult t={t} result={{
    ok: false, error: 'unparseable', effectiveModel: null, warning: 'Fallback warning retained',
  }} />)
  expect(failed).toContain('Fallback warning retained')
  expect(failed).toContain('projectRoadmap.ai.effectiveUnknown')
  expect(renderToStaticMarkup(<RoadmapModelResult t={t} result={null} />)).toBe('')
})
