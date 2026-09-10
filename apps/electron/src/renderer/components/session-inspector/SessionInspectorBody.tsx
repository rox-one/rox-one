import { useTranslation } from 'react-i18next'
import type { InspectorSectionId } from '@/atoms/unified-shell'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { WebBrowserPanel } from '@/components/browser/WebBrowserPanel'
import { SessionGitPanel } from './SessionGitPanel'

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
  const { t } = useTranslation()

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
    return <WebBrowserPanel open embedded onClose={() => undefined} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <span className="text-[13px] font-medium text-foreground/80">
        {t('inspector.empty.context.title')}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground/60">
        {t('inspector.empty.context.body')}
      </span>
    </div>
  )
}
