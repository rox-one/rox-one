/**
 * RepoWatchControls (В8, v1.x O10) — the per-repo auto-watch controls render
 * only their actual state: the switch reflects consent, auto-pull/interval
 * appear only once watching is on, and the consent hint rides the label.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInstance, type i18n as I18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { DevSpaceRepositoryRecord } from '@rox/shared/dev-space'
import { RepoWatchControls } from '../components/RepoWatchControls'

let i18n: I18n
beforeAll(async () => {
  i18n = createInstance()
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    resources: {
      en: {
        translation: {
          'devSpace.watch.toggle': 'Watch',
          'devSpace.watch.toggleHint': 'Allow background git fetch.',
          'devSpace.watch.interval': 'Check interval',
          'devSpace.watch.intervalHours': '{{hours}} h',
          'devSpace.watch.autoPull': 'Auto-pull',
          'devSpace.watch.autoPullHint': 'Fast-forward the working copy.',
          'devSpace.watch.networkError': 'Could not update watch settings.',
        },
      },
    },
  })
})

function record(overrides: Partial<DevSpaceRepositoryRecord> = {}): DevSpaceRepositoryRecord {
  return {
    schemaVersion: 1,
    id: 'devrepo_a',
    repositoryId: 'repo_a',
    workspaceId: 'ws',
    projectId: 'p1',
    projectSlug: 'demo',
    origin: { kind: 'git-url', url: 'https://github.com/rox/one.git', provider: 'github' },
    displayName: 'one',
    status: 'ready',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const render = (value: DevSpaceRepositoryRecord) =>
  renderToStaticMarkup(
    React.createElement(I18nextProvider, { i18n }, React.createElement(RepoWatchControls, { record: value, onChanged() {} })),
  )

describe('RepoWatchControls (В8)', () => {
  it('renders the consent switch and hides the refinements while off', () => {
    const html = render(record())
    expect(html).toContain('dev-space-watch-toggle')
    expect(html).toContain('aria-label="Watch"')
    expect(html).toContain('Allow background git fetch.')
    expect(html).not.toContain('dev-space-watch-autopull')
    expect(html).not.toContain('dev-space-watch-interval')
  })

  it('shows the auto-pull checkbox and interval select once watching is on', () => {
    const html = render(record({ watchEnabled: true, watchAutoPull: true, watchIntervalMs: 7_200_000 }))
    expect(html).toContain('dev-space-watch-autopull')
    expect(html).toContain('dev-space-watch-interval')
    expect(html).toContain('aria-label="Check interval"')
    expect(html).toContain('Auto-pull')
    expect(html).toContain('Fast-forward the working copy.')
  })
})