import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import type { InspectorSectionId } from '@/atoms/unified-shell'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { SessionGitPanel } from './SessionGitPanel'
import { SessionContextPanel } from './SessionContextPanel'

export function SessionInspectorBody({
  section,
  sessionId,
  sessionFolderPath,
  cwd,
}: {
  section: InspectorSectionId
  sessionId: string | null
  sessionFolderPath?: string
  cwd: string | undefined
}) {
  if (section === 'files') {
    return (
      <SessionFilesSection
        sessionId={sessionId ?? undefined}
        sessionFolderPath={sessionFolderPath}
        hideHeader
        className="h-full min-h-0"
      />
    )
  }

  if (section === 'git') {
    return <SessionGitPanel cwd={cwd} />
  }

  if (section === 'browser') {
    return <InspectorBrowserStub />
  }

  return <SessionContextPanel sessionId={sessionId} />
}

function InspectorBrowserStub() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Globe className="h-6 w-6 text-muted-foreground/40" />
      <span className="text-[13px] font-medium text-foreground/80">
        {t('inspector.browserDisabled', { defaultValue: 'Browser stays in the dock. Native windows are not opened from here.' })}
      </span>
    </div>
  )
}
