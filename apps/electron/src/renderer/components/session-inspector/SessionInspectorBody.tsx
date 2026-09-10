import type { InspectorSectionId } from '@/atoms/unified-shell'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { WebBrowserPanel } from '@/components/browser/WebBrowserPanel'
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
    return <WebBrowserPanel open embedded onClose={() => undefined} />
  }

  return <SessionContextPanel sessionId={sessionId} />
}
