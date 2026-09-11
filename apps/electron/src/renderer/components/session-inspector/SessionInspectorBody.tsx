import type { InspectorSectionId } from '@/atoms/unified-shell'
import { SessionFilesSection } from '@/components/right-sidebar/SessionFilesSection'
import { SessionGitPanel } from './SessionGitPanel'
import { SessionContextPanel } from './SessionContextPanel'
import { InspectorBrowserPane } from './InspectorBrowserPane'

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
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <InspectorBrowserPane />
      </div>
    )
  }

  return <SessionContextPanel sessionId={sessionId} />
}
