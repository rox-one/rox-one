import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { selectedConnectionAtom } from '@/atoms/connections'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { ConnectionLifecyclePanel } from '@/pages/ConnectionLifecyclePanel'

export function ConnectionInfoSection() {
  const { t } = useTranslation()
  const selected = useAtomValue(selectedConnectionAtom)
  const context = useOptionalAppShellContext()
  const workspaceId = context?.activeWorkspaceId
  if (!selected || !workspaceId || selected.workspaceId !== workspaceId) {
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Info className="h-6 w-6 text-muted-foreground/40" />
      <span className="text-[13px] font-medium text-foreground/80">{t('inspector.empty.connections.title')}</span>
      <span className="text-[12px] leading-relaxed text-muted-foreground/60">{t('inspector.empty.connections.body')}</span>
    </div>
  }
  return <div className="min-h-0 flex-1 overflow-y-auto"><ConnectionLifecyclePanel connection={selected} workspaceId={workspaceId} /></div>
}
