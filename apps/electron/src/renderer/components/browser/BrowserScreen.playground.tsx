import * as React from 'react'
import { Globe2, LockKeyhole, Sparkles } from 'lucide-react'
import { BrowserControls, BrowserEmptyStateCard } from '@craft-agent/ui'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { BrowserTabStrip } from './BrowserTabStrip'
import type { BrowserInstanceInfo } from '../../../shared/types'

const mockInstances: BrowserInstanceInfo[] = [
  {
    id: 'browser-open-design',
    title: 'Open Design',
    url: 'http://127.0.0.1:3000',
    favicon: null,
    isLoading: false,
    canGoBack: true,
    canGoForward: false,
    boundSessionId: 'session-open-design',
    ownerType: 'session',
    ownerSessionId: 'session-open-design',
    isVisible: true,
    agentControlActive: true,
    themeColor: '#4f46e5',
    workspaceId: 'workspace-playground',
  },
  {
    id: 'browser-docs',
    title: 'Design System Docs',
    url: 'https://example.com/design-system',
    favicon: null,
    isLoading: true,
    canGoBack: false,
    canGoForward: false,
    boundSessionId: 'session-docs',
    ownerType: 'session',
    ownerSessionId: 'session-docs',
    isVisible: true,
    agentControlActive: false,
    themeColor: null,
    workspaceId: 'workspace-playground',
  },
]

function BrowserScreenStory() {
  const [url, setUrl] = React.useState('http://127.0.0.1:3000')

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 px-3">
        <BrowserTabStrip activeSessionId="session-open-design" instancesOverride={mockInstances} maxVisibleBadges={4} />
        <div className="ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Visual CI fixture
        </div>
      </div>

      <BrowserControls
        url={url}
        loading={false}
        canGoBack
        canGoForward={false}
        onNavigate={setUrl}
        onUrlChange={setUrl}
        leadingContent={<Globe2 className="h-4 w-4 text-muted-foreground" />}
        trailingContent={
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600">
            <LockKeyhole className="h-3 w-3" />
            Local runtime
          </span>
        }
        className="shrink-0 border-b border-border/60"
      />

      <main className="min-h-0 flex-1 bg-foreground-2 p-4">
        <div className="h-full overflow-hidden rounded-xl border border-border/60 bg-background shadow-thin">
          <BrowserEmptyStateCard
            title="Open Design runtime"
            description="URL-backed BrowserView surface for the separately running Open Design web app and daemon."
            prompts={[
              { short: 'Open design system dashboard', full: 'Open the local Open Design dashboard and inspect recent artifacts.' },
              { short: 'Review generated frame', full: 'Open the latest generated frame and compare it against the ROX shell.' },
            ]}
            showExamplePrompts
            showSafetyHint={false}
          />
        </div>
      </main>
    </div>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-browser-open-design-${viewportId}`,
  name: `Browser Open Design Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Browser',
  level: 'Screens',
  description: 'Deterministic Browser screen using production controls and tab strip without live IPC or BrowserView creation.',
  component: BrowserScreenStory,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))
