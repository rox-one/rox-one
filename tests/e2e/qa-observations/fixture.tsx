import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, createStore, useAtomValue, useSetAtom } from 'jotai'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip'
import en from '../../../packages/shared/src/i18n/locales/en.json'
import { SkillsListPanel } from '../../../apps/electron/src/renderer/components/app-shell/SkillsListPanel'
import { MainContentPanel } from '../../../apps/electron/src/renderer/components/app-shell/MainContentPanel'
import { AppShellProvider } from './stubs'
import { skillSelection } from '../../../apps/electron/src/renderer/hooks/useEntitySelection'
import { parseRouteToNavigationState } from '../../../apps/electron/src/shared/route-parser'
import { RPC_CHANNELS } from '../../../packages/shared/src/protocol/channels'
import { PanelStackContainer } from '../../../apps/electron/src/renderer/components/app-shell/PanelStackContainer'
import { panelStackAtom, focusedPanelIdAtom, pushPanelAtom, updateFocusedPanelRouteAtom } from '../../../apps/electron/src/renderer/atoms/panel-stack'
import { routes } from '../../../apps/electron/src/shared/routes'
import type { LoadedSkill } from '../../../apps/electron/src/shared/types'
import '../../../apps/electron/src/renderer/index.css'

await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
const metrics = { selections: [] as string[], imports: [] as string[], lists: 0, details: [] as string[], clickedAt: 0, detailMs: [] as number[], clicks: [] as string[] }
document.addEventListener('click', event => {
  const target = event.target as Element
  if (target.closest('[data-list-role="omp-skills"] li')) metrics.clicks.push(target.textContent ?? '')
}, true)
async function rpc(channel: string, workspaceId: string, ...args: unknown[]) {
  const response = await fetch('/qa-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, workspaceId, args }) })
  if (!response.ok) throw new Error('controlled read error')
  return response.json()
}
const subscribers = new Set<(workspaceId: string, skills: LoadedSkill[]) => void>()
window.electronAPI = {
  listPendingSkills: async () => [], getSkillUsage: async () => ({}), listBundledSkillPacks: async () => [],
  onSkillsPendingChanged: () => () => {},
  onSkillsChanged: (callback: (workspaceId: string, skills: LoadedSkill[]) => void) => { subscribers.add(callback); return () => subscribers.delete(callback) },
  onBundledSkillsChanged: () => () => {},
  getSkills: async (workspaceId: string) => { metrics.lists++; return rpc(RPC_CHANNELS.skills.GET, workspaceId) },
  getSkillDetails: async (workspaceId: string, slug: string, workingDirectory?: string) => {
    metrics.details.push(`${workspaceId}:${slug}`)
    return rpc(RPC_CHANNELS.skills.GET_DETAILS, workspaceId, slug, workingDirectory)
  },
  importOmpSkill: async (_workspace: string, slug: string) => { metrics.imports.push(slug); return { slug } },
} as any
const skills = await window.electronAPI.getSkills('fixture')
;(window as any).qa = { metrics, skills, emitSkillsChanged: (workspaceId: string) => subscribers.forEach(callback => callback(workspaceId, skills)) }
const store = createStore()
new MutationObserver(() => {
  const content = document.querySelector('[data-testid="detail"] pre')
  const selected = metrics.selections.at(-1)
  if (metrics.clickedAt && selected && content?.textContent?.includes(`Instructions for ${selected}`)) {
    metrics.detailMs.push(performance.now() - metrics.clickedAt)
    metrics.clickedAt = 0
  }
}).observe(document.getElementById('root')!, { childList: true, subtree: true, characterData: true })
store.set(updateFocusedPanelRouteAtom, 'settings/shortcuts')
function SkillFixture() {
  const [selected, setSelected] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState('fixture')
  const selectionCount = skillSelection.useSelectionCount()
  const route = selected ? routes.view.skills(selected) : routes.view.skills()
  return <AppShellProvider value={{ workspaces: [], activeWorkspaceId: workspaceId, sessionStatuses: [], projects: [], loadedProjects: [], labels: [] }}><div className="h-screen flex bg-background text-foreground">
    <aside className="w-[360px] shrink-0 overflow-y-auto p-2" data-testid="skills-list">
      <SkillsListPanel skills={skills} selectedSkillSlug={selected} workspaceId={workspaceId} onDeleteSkill={() => {}}
        onSkillClick={skill => { metrics.clickedAt = performance.now(); metrics.selections.push(skill.slug); setSelected(skill.slug) }} />
    </aside>
    <main className="flex-1 min-w-0" data-testid="detail">
      <output data-testid="route">{route}</output><output data-testid="selection-count">{selectionCount}</output>
      <button data-testid="workspace-b" onClick={() => setWorkspaceId('fixture-b')}>Switch workspace</button>
      <MainContentPanel navStateOverride={parseRouteToNavigationState(route)} />
    </main>
  </div></AppShellProvider>
}
function PanelFixture() {
  const push = useSetAtom(pushPanelAtom)
  const panels = useAtomValue(panelStackAtom)
  const focused = useAtomValue(focusedPanelIdAtom)
  return <div className="h-screen flex flex-col bg-background text-foreground">
    <header className="h-[70px] shrink-0 p-4">
      <button data-testid="add-panel" onClick={() => push({ route: 'allSessions/session/fixture-session', intent: 'explicit' })}>New session in panel</button>
      <output data-testid="focused">{focused}</output><output data-testid="panel-count">{panels.length}</output>
    </header>
    <div className="flex flex-1 min-h-0" style={{ paddingLeft: 56, paddingRight: 44 }}>
      <PanelStackContainer sidebarSlot={<div>Sidebar</div>} sidebarWidth={320}
        navigatorSlot={<div>Settings shortcuts</div>} navigatorWidth={300} isSidebarAndNavigatorHidden={false} />
    </div>
  </div>
}
createRoot(document.getElementById('root')!).render(<Provider store={store}><TooltipProvider>
  {location.search.includes('panels') ? <PanelFixture /> : <SkillFixture />}
</TooltipProvider></Provider>)
