import type { TargetId, TourDefinition } from '../../../contracts'
import { dynamicTourId } from '../../dynamic'

/** Valid generated dev-space tour used by the dynamic-source contract tests (D9). */
export function devSpaceTour(overrides: Partial<TourDefinition> = {}): TourDefinition {
  return {
    id: dynamicTourId('DS', 'repo-overview', 1),
    slug: 'repo-overview',
    version: 1,
    title: 'Обзор репозитория',
    goal: 'Понять карту репозитория.',
    why: 'Сгенерировано из артефактов.',
    trigger: 'Открытие dev space.',
    entryTriggers: ['devspace-opened'],
    titleKey: 'productTour.repo-overview.name',
    goalKey: 'productTour.repo-overview.goal',
    whyKey: 'productTour.repo-overview.why',
    requires: ['devspace.available'],
    owner: 'A2',
    evidence: ['artifact-repo-overview'],
    priority: 'P1',
    steps: [{
      id: 'devspace.repo.overview',
      version: 1,
      target: 'devspace.repo.overview' as TargetId,
      routeKey: 'devspace-repo',
      scope: 'bound-panel',
      copyKey: 'productTour.repo-overview.devspace.repo.overview.',
      copy: { ru: { title: 'Обзор', body: 'Тело' }, en: { title: 'Overview', body: 'Body' } },
      completion: { kind: 'ack', signal: null, evidence: 'acknowledged', priorState: 'after-activation', requireAcknowledgementAfterEvidence: false },
      handoff: false,
      optional: false,
      requires: [],
      onUnavailable: 'block',
      missingTarget: 'block-and-offer-retry-or-pause',
      notes: '',
      testId: 'T-DEVSPACE-OVERVIEW',
    }],
    ...overrides,
  }
}