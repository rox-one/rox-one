import { describe, expect, test, mock } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AppShellContextType } from '../../../context/AppShellContext'
import type { LlmConnectionWithStatus, WorkspaceSettings } from '../../../../shared/types'

// Run separately: module mocks isolate the overview from the full app shell.
let context: Pick<AppShellContextType, 'activeWorkspaceId' | 'llmConnections' | 'workspaceDefaultLlmConnection'>
let workspaceSettings: Pick<WorkspaceSettings, 'defaultLlmConnection' | 'model'>

// SSR cannot mount IPC effects. Supply their qualified result at the read boundary;
// the browser fixture exercises the real hook's pending, failure, and race paths.
mock.module('../useWorkspaceAiSettings', () => ({
  useWorkspaceAiSettings: () => ({ settings: workspaceSettings, isLoading: false }),
}))

mock.module('../../../context/AppShellContext', () => ({
  useAppShellContext: () => context,
  useActiveWorkspace: () => ({ id: 'ws-1', name: 'QA workspace', rootPath: '/fixture/workspace' }),
}))
mock.module('../../../components/app-shell/PanelHeader', () => ({
  PanelHeader: ({ title }: { title: string }) => createElement('header', null, title),
}))
mock.module('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { SettingsOverviewPage } = await import('../SettingsOverviewPage')

const rox: LlmConnectionWithStatus = {
  slug: 'rox-kimi', name: 'ROX', providerType: 'omp', authType: 'none',
  defaultModel: 'rox/standard', createdAt: 1, isDefault: true, isAuthenticated: true,
}
const custom: LlmConnectionWithStatus = {
  slug: 'custom', name: 'Custom endpoint', providerType: 'pi_compat', authType: 'none',
  defaultModel: 'custom/model', createdAt: 2, isAuthenticated: true,
}

function render(connections: LlmConnectionWithStatus[], workspaceDefault?: string): string {
  context = { activeWorkspaceId: 'ws-1', llmConnections: connections, workspaceDefaultLlmConnection: 'stale-shell-override' }
  workspaceSettings = { defaultLlmConnection: workspaceDefault }
  return renderToStaticMarkup(createElement(SettingsOverviewPage))
}

describe('ROX-006 settings overview effective AI configuration', () => {
  test('inherits the global ROX default without a workspace override', () => {
    const html = render([custom, rox])
    expect(html).toContain('ROX')
    expect(html).toContain('rox/standard')
    expect(html).not.toContain('settings.overview.noConnection')
  })

  test('an explicit workspace connection wins over the global default', () => {
    const html = render([rox, custom], 'custom')
    expect(html).toContain('Custom endpoint')
    expect(html).toContain('custom/model')
    expect(html).not.toContain('rox/standard')
  })

  test('uses the first available connection if no global default is marked', () => {
    const html = render([custom])
    expect(html).toContain('Custom endpoint')
    expect(html).not.toContain('settings.overview.noConnection')
  })

  test('shows the existing unconfigured message when there are no connections', () => {
    const html = render([])
    expect(html).toContain('settings.overview.noConnection')
    expect(html).toContain('settings.overview.attention')
  })

  test('does not silently replace a missing explicit workspace connection', () => {
    const html = render([rox], 'deleted-connection')
    expect(html).toContain('settings.overview.noConnection')
    expect(html).toContain('settings.overview.attention')
    expect(html).not.toContain('rox/standard')
  })

  test('authentication failure does not turn a configured connection into an unconfigured one', () => {
    const html = render([{ ...rox, isAuthenticated: false, authError: 'Fixture credentials unavailable' }])
    expect(html).toContain('ROX')
    expect(html).toContain('rox/standard')
    expect(html).not.toContain('settings.overview.noConnection')
    expect(html).not.toContain('settings.overview.attention')
  })

  test('a connection with no model displays its slug instead of an unrelated model', () => {
    const html = render([{ ...custom, defaultModel: undefined }], 'custom')
    expect(html).toContain('Custom endpoint')
    expect(html).toContain('custom')
    expect(html).not.toContain('custom/model')
    expect(html).not.toContain('settings.overview.noConnection')
  })
})
