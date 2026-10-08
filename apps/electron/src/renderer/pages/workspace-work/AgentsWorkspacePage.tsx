import { useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppShellContext } from '@/context/AppShellContext'
import { AgentProfilesView } from './AgentProfilesView'
import { ShellSidebarPortal } from '@/components/app-shell/ShellSidebarPortal'
const Executions = lazy(() => import('@/pages/extra-screens/agents/AgentCenterPage'))

export default function AgentsWorkspacePage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const [section, setSection] = useState<'profiles' | 'executions'>('profiles')
  if (!activeWorkspaceId) return null
  return <div className="flex h-full min-h-0 flex-col">
    <ShellSidebarPortal className="flex shrink-0 flex-row gap-1 border-b border-border p-2">
      {(['profiles', 'executions'] as const).map(value => <button type="button" key={value} onClick={() => setSection(value)} aria-current={section === value ? 'page' : undefined} className={`rounded px-3 py-2 text-left text-sm ${section === value ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>{t(`navigation.agentSections.${value}`)}</button>)}
    </ShellSidebarPortal>
    <div className="min-h-0 flex-1">
      {section === 'profiles' ? <AgentProfilesView workspaceId={activeWorkspaceId} /> : <Suspense fallback={<div role="status">{t('common.loading')}</div>}><Executions itemId={null} /></Suspense>}
    </div>
  </div>
}
