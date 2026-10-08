import { mock, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ReactNode } from 'react'
import { TooltipProvider } from '@radix-ui/react-tooltip'
import { DEFAULT_THEME } from '@config/theme'
import { routes } from '../../../shared/routes'

// SSR exercises unavailable native capabilities without calling a provider.
Object.assign(globalThis, { window: { electronAPI: {}, addEventListener() {}, removeEventListener() {} } })

const translations = await import('react-i18next')
mock.module('react-i18next', () => ({ ...translations, useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
mock.module('../../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false, shikiTheme: 'github-light', presetTheme: null, resolvedTheme: DEFAULT_THEME, isScenic: false }) }))
const shell = await import('../../context/AppShellContext')
mock.module('../../context/AppShellContext', () => ({ ...shell,
  useAppShellContext: () => ({ pendingPermissions: new Map(), pendingCredentials: new Map(), sessionOptions: new Map(), sessionMap: new Map() }), useOptionalAppShellContext: () => ({ activeWorkspaceId: 'ws1' }),
  useActiveWorkspace: () => ({ id: 'ws1', name: 'Workspace', rootPath: '/fixture/workspace' }),
}))
const navigation = await import('../../contexts/NavigationContext')
mock.module('../../contexts/NavigationContext', () => ({ ...navigation, routes, useNavigation: () => ({ navigate() {}, navigateToSession() {} }) }))
mock.module('../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: false, shikiTheme: 'github-light', presetTheme: null, theme: DEFAULT_THEME, defaultTheme: DEFAULT_THEME, isScenic: false }) }))

const { AutomationEditor } = await import('../automations/AutomationEditor')
const { AutomationInfoPage } = await import('../automations/AutomationInfoPage')
const { CalendarStatusStrip } = await import('../calendar/CalendarStatusStrip')
const { MemoryScreen } = await import('../memory/MemoryScreen')
const { LearningScreen } = await import('../learning/LearningScreen')
const { ShikiCodeEditor } = await import('../shiki/ShikiCodeEditor')
const { useInboxItems } = await import('../../hooks/useInboxItems')
const { EscapeInterruptProvider } = await import('../../context/EscapeInterruptContext')
function render(node: ReactNode) { return renderToStaticMarkup(createElement(TooltipProvider, { children: createElement(EscapeInterruptProvider, { children: node }) })) }
const automation = { id: 'fixture', revision: 'fixture-revision', event: 'SchedulerTick' as const, matcherIndex: 0, name: 'Fixture', summary: '', enabled: true, cron: '0 9 * * *', timezone: 'UTC', actions: [{ type: 'prompt' as const, prompt: 'Inspect local files' }] }
expect(render(createElement(AutomationEditor, { automation, workspaceId: 'ws1' }))).toContain('Inspect local files')
expect(render(createElement(AutomationInfoPage, { automation }))).toContain('Fixture')
expect(render(createElement(CalendarStatusStrip, { tasks: [], now: Date.now() }))).toContain('calendar-status-strip')
expect(render(createElement(MemoryScreen, { workspaceId: 'ws1' }))).toContain('memory.')
expect(render(createElement(LearningScreen, { workspaceId: 'ws1' }))).toContain('learning.')
expect(render(createElement(ShikiCodeEditor, { value: '# Local note', language: 'md' }))).toContain('# Local note')
function InboxMount() { const inbox = useInboxItems(); return createElement('div', null, JSON.stringify(inbox.items)) }
expect(render(createElement(InboxMount))).toContain('[]')
console.log('RENDERER_CONTRACT_RECOVERY_OK')
