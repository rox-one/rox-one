import { useState, type ReactNode } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { useTranslation } from 'react-i18next'
import { X, Plus, Paperclip } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { parseRouteToNavigationState } from '../../../shared/route-parser'
import { primaryPanelRouteAtom, parseSessionIdFromRoute, updatePanelRouteByIdAtom, type PanelStackEntry } from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { automationsAtom } from '@/atoms/automations'
import { MainContentPanel } from './MainContentPanel'
import { activeWorkspaceContextAtom, workspaceProjectContextsAtom } from '@/atoms/workspace-context'
import { useWorkspaceWork } from '@/lib/useWorkspaceWork'

export function AuxiliaryToolPanel({ entry, onClose }: { entry: PanelStackEntry; onClose: () => void }) {
  const { t } = useTranslation()
  const shell = useAppShellContext()
  const store = useStore()
  const { navigate } = useNavigation()
  const sessions = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)
  const [tab, setTab] = useState<'dialogue' | 'sources' | 'skills'>('dialogue')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const sessionId = parseSessionIdFromRoute(entry.route)
  const meta = sessionId ? sessions.get(sessionId) : undefined
  const workspaceId = entry.toolContext?.workspaceId ?? shell.activeWorkspaceId
  const projectId = meta?.projectId ?? entry.toolContext?.projectId
  const project = shell.projects?.find(project => project.id === projectId)
  const profile = meta?.agentProfileSnapshot
  const availableSources = (shell.enabledSources ?? []).filter(source => !profile || profile.sourceSlugs.includes(source.config.slug))
  const availableSkills = (shell.skills ?? []).filter(skill => !profile || profile.skillSlugs.includes(skill.slug))
  const work = useWorkspaceWork(workspaceId ?? '')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const selectedProfileUnavailable = !!selectedProfileId && !work.snapshot?.profiles.some(item => item.id === selectedProfileId)
  const newDialogue = async () => {
    if (!workspaceId || creating || (selectedProfileId && !work.snapshot?.profiles.some(item => item.id === selectedProfileId))) return
    setCreating(true)
    try {
      const created = await shell.onCreateSession(workspaceId, { projectId, agentProfileId: selectedProfileId || undefined })
      // Scope captured at click; never redirect a late result into another workspace.
      if (store.get(activeWorkspaceContextAtom) !== workspaceId) return
      store.set(updatePanelRouteByIdAtom, { id: entry.id, route: routes.view.allSessions(created.id) })
      setTab('dialogue')
    } catch (error) { setCreateError(error instanceof Error ? error.message : t('common.error')) }
    finally { setCreating(false) }
  }
  const addContext = () => {
    if (!sessionId || !workspaceId) return
    const route = store.get(primaryPanelRouteAtom)
    if (!route) return
    const reference = t('navigation.contextMessage', { workspaceId, projectId: store.get(workspaceProjectContextsAtom)[workspaceId] ?? '', route })
    const draft = shell.getDraft(sessionId)
    shell.onInputChange(sessionId, `${draft}${draft ? '\n\n' : ''}${reference}`)
  }
  let content: ReactNode = null
  if (entry.tool === 'agent' && tab === 'sources') content = (
    <div className="overflow-y-auto p-3 space-y-2">
      {availableSources.map(source => <label key={source.config.slug} className="flex gap-2 text-sm">
        <input type="checkbox" checked={meta?.enabledSourceSlugs?.includes(source.config.slug) ?? false}
          onChange={event => { if (sessionId) shell.onSessionSourcesChange?.(sessionId, event.target.checked
            ? [...(meta?.enabledSourceSlugs ?? []), source.config.slug]
            : (meta?.enabledSourceSlugs ?? []).filter(slug => slug !== source.config.slug)) }} />
        <span>{source.config.name}</span>
      </label>)}
      {!availableSources.length && <p className="text-sm text-muted-foreground">{t('navigation.noSources')}</p>}
    </div>
  )
  if (entry.tool === 'agent' && tab === 'skills') content = (
    <div className="overflow-y-auto p-3 space-y-2">
      {availableSkills.map(skill => <button key={skill.slug} type="button" className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-foreground/5"
        onClick={() => { if (sessionId) shell.onInputChange(sessionId, `${shell.getDraft(sessionId)} @${skill.slug} `); setTab('dialogue') }}>
        {skill.metadata.name ?? skill.slug}
      </button>)}
      {!availableSkills.length && <p className="text-sm text-muted-foreground">{t('navigation.noSkills')}</p>}
    </div>
  )
  if (workspaceId && shell.activeWorkspaceId !== workspaceId) return <div role="status" className="p-4">{t('common.loading')}</div>
  return (
    <div className="flex h-full min-h-0 flex-col" data-tool-panel={entry.tool}>
      <header className="flex shrink-0 items-center gap-2 border-b border-foreground/5 px-3 py-2">
        <span className="text-sm font-semibold">{t(`navigation.tools.${entry.tool}`)}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{project?.name ?? t('navigation.allProjects')}</span>
        {entry.tool === 'agent' && <button type="button" disabled={creating || selectedProfileUnavailable} onClick={() => { void newDialogue() }} title={t('navigation.newDialogue')} aria-label={t('navigation.newDialogue')} className="rounded p-1 hover:bg-foreground/5 disabled:opacity-40"><Plus className="size-4" /></button>}
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded p-1 hover:bg-foreground/5"><X className="size-4" /></button>
      </header>
      {entry.tool === 'agent' && <div className="flex shrink-0 flex-wrap gap-1 border-b border-foreground/5 px-2 py-1">
        {(['dialogue', 'sources', 'skills'] as const).map(item => <button type="button" key={item} onClick={() => setTab(item)} aria-pressed={tab === item}
          className={`rounded px-2 py-1 text-xs ${tab === item ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>{t(`navigation.agentTabs.${item}`)}</button>)}
        <button type="button" onClick={addContext} className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs" title={t('navigation.addContext')}><Paperclip className="size-3" />{t('navigation.addContext')}</button>
      </div>}
      {entry.tool === 'automations' && <div className="max-h-40 shrink-0 overflow-y-auto border-b border-foreground/5 p-2">
        {automations.filter(rule => !rule.context || rule.context.projectId === entry.toolContext?.projectId).map(rule => (
          <button type="button" key={rule.id} className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-foreground/5"
            onClick={() => navigate(routes.view.automations({ automationId: rule.id }))}>{rule.name ?? rule.id}</button>
        ))}
      </div>}
      {entry.tool === 'agent' && work.snapshot && <label className="flex shrink-0 items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
        {t('navigation.newDialogueProfile')}
        <select value={selectedProfileId} onChange={event => setSelectedProfileId(event.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-1">
          <option value="">{t('navigation.defaultProfile')}</option>
          {selectedProfileId && !work.snapshot.profiles.some(item => item.id === selectedProfileId) && <option value={selectedProfileId} disabled>{t('navigation.work.profiles.deleted')}</option>}
          {work.snapshot.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
      </label>}
      {createError && <div role="alert" className="px-3 py-1 text-xs text-destructive">{createError}</div>}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={entry.tool === 'agent' && tab !== 'dialogue' ? 'hidden h-full' : 'h-full'}>
          <MainContentPanel navStateOverride={parseRouteToNavigationState(entry.route)} isSidebarAndNavigatorHidden={false} panelId={entry.id} />
        </div>
        {content && <div className="h-full">{content}</div>}
      </div>
    </div>
  )
}
