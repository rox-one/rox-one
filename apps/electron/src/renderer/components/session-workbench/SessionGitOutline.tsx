[~/Git/rox-one/apps/electron/src/renderer/components/session-workbench/SessionGitOutline.tsx#4610]
1:import * as React from 'react'
2:import { GitBranch, GitCommit } from 'lucide-react'
3:import { useTranslation } from 'react-i18next'
4:import { cn } from '@/lib/utils'
5:import {
6:  extractSessionVariables,
7:  projectSessionScenes,
8:  type SceneMessage,
9:} from '@craft-agent/core/mindmap'
10:
11:export type RelatedBranch = { id: string; name: string }
12:
13:export type SessionGitOutlineProps = {
14:  sessionId: string
15:  messages: SceneMessage[]
16:  relatedBranches?: RelatedBranch[]
17:  onCheckoutMessage?: (messageId: string) => void
18:  onFork?: (messageId: string) => void
19:  onOpenSession?: (sessionId: string) => void
20:  onInsertVariable?: (name: string, value?: string) => void
21:}
22:
23:export function SessionGitOutline({
24:  sessionId,
25:  messages,
26:  relatedBranches = [],
27:  onCheckoutMessage,
28:  onFork,
29:  onOpenSession,
30:  onInsertVariable,
31:}: SessionGitOutlineProps) {
32:  const { t } = useTranslation()
33:  const graph = React.useMemo(
34:    () => projectSessionScenes(sessionId, messages),
35:    [sessionId, messages],
36:  )
37:  const variables = React.useMemo(
38:    () =>
39:      extractSessionVariables(
40:        messages.map((m) => ({ id: m.id, content: m.content ?? '' })),
41:      ),
42:    [messages],
43:  )
44:
45:  return (
46:    <div className="h-full min-h-0 flex-1 overflow-auto px-4 py-3 text-sm">
47:      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
48:        {t('entityView.outlineLog')}
49:      </div>
50:      <ul>
…
102:      </ul>
103:
104:      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
105:        {t('entityView.outlineBranches')}
106:      </div>
107:      {relatedBranches.length === 0 ? (
108:        <p className="text-xs text-muted-foreground">{t('entityView.outlineNoBranches')}</p>
109:      ) : (
110:        <ul className="space-y-1">
…
122:        </ul>
123:      )}
124:
125:      <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
126:        {t('entityView.outlineVariables')}
127:      </div>
128:      {variables.length === 0 ? (
129:        <p className="text-xs text-muted-foreground">{t('entityView.outlineNoVariables')}</p>
130:      ) : (
131:        <ul className="space-y-1">
…
150:        </ul>
151:      )}
152:    </div>
153:  )
154:}

[…80ln elided; re-read needed ranges, e.g. /Users/marklindgreen/Git/rox-one/apps/electron/src/renderer/components/session-workbench/SessionGitOutline.tsx:51-101,111-121]