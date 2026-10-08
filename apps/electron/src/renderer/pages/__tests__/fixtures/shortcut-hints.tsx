// Run in a fresh Bun process: platform detection is an import-time constant.
// Only shell/navigation context is stubbed; the pages, formatter and translations
// are real. SSR never mounts effects or connects to the user's Electron app.
import { mock } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { setupI18n } from '@rox/shared/i18n/setupI18n'
import { PersonalTaskStore } from '@rox/core/tasks/personal'

// Read-only SSR has no installed native bridge; unavailable capabilities stay unavailable.
Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {} } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { platform: process.argv[2] ?? 'Win32' } })
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} })
const shell = await import('../../../context/AppShellContext')
mock.module('../../../context/AppShellContext', () => ({
  ...shell,
  useActiveWorkspace: () => null,
  useOptionalAppShellContext: () => null,
}))
const navigation = await import('../../../contexts/NavigationContext')
mock.module('../../../contexts/NavigationContext', () => ({ ...navigation, useNavigation: () => ({ navigate: () => {} }) }))
// Menu primitives import Vite-only theme discovery even with no actions present.
mock.module('../../../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }))

const { ActionRegistryProvider, useActionRegistry } = await import('../../../actions/registry')
const { TooltipProvider } = await import('@rox/ui')
const { default: TasksPage } = await import('../../TasksPage')
const { TaskDetail } = await import('../../tasks/TaskDetail')
const { QuickEntry } = await import('../../tasks/QuickEntry')
const { default: MeetingsPage } = await import('../../MeetingsPage')
const { MemoryScreen } = await import('../../../components/memory/MemoryScreen')
const { LearningScreen } = await import('../../../components/learning/LearningScreen')
const { MultiSelectPanel } = await import('../../../components/app-shell/MultiSelectPanel')

const i18n = setupI18n()
await i18n.changeLanguage(process.argv[3] ?? 'ru')
const store = new PersonalTaskStore()
const task = store.create({ title: 'ROX-004', now: new Date('2026-10-03T12:00:00Z').getTime() })
const noop = () => {}
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nextProvider i18n={i18n}><TooltipProvider>{node}</TooltipProvider></I18nextProvider>)
function RegistryHints() {
  const registry = useActionRegistry()
  return <span>{registry.getHotkeyDisplay('app.newChat')} / {registry.getHotkeyDisplay('app.omnibox')}</span>
}

const surfaces = {
  tasks: render(<ActionRegistryProvider><TasksPage /></ActionRegistryProvider>),
  detail: render(<TaskDetail draft={undefined} isDraftCurrent={() => true} onDraftChange={noop} onDraftSubmit={noop} task={task} store={store} mutate={noop} now={task.createdAt} subtasks={[]} allTags={[]}
    placeLabel={i18n.t('tasks.projection.inbox')} sessionMap={new Map()} agentChip={null} delegating={false}
    delegateError={null} canDelegate onDelegate={noop} onToggleComplete={noop} onOpenMove={noop}
    onOpenSource={noop} onOpenSession={noop} onOpenBoard={noop} onTrash={noop} onClose={noop}
    titleRef={React.createRef<HTMLInputElement>()} popover="when" setPopover={noop} />),
  quickEntry: render(<QuickEntry onClose={noop} onSubmit={noop} destinationLabel={i18n.t('tasks.projection.inbox')}
    projects={[]} areas={[]} now={task.createdAt} />),
  memory: render(<MemoryScreen />),
  learning: render(<LearningScreen />),
  meetings: render(<MeetingsPage />),
  selection: render(<MultiSelectPanel count={2} />),
  registry: render(<ActionRegistryProvider><RegistryHints /></ActionRegistryProvider>),
}
console.log(JSON.stringify(surfaces))
