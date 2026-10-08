import * as React from 'react'
import SettingsNavigator from './SettingsNavigator'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS, type PlaygroundViewportPresetId } from '@/playground/registry/types'
import { ensureMockElectronAPI } from '@/playground/mock-utils'
import type { SettingsSubpage } from '../../../shared/types'

function useSafeOpenUrlOverride() {
  React.useEffect(() => {
    ensureMockElectronAPI()
    const originalOpenUrl = window.electronAPI.openUrl

    window.electronAPI.openUrl = async (url: string) => {
      console.log('[SettingsNavigator Playground] openUrl suppressed:', url)
    }

    return () => {
      window.electronAPI.openUrl = originalOpenUrl
    }
  }, [])
}

function SettingsNavigatorScreenStory() {
  const [selectedSubpage, setSelectedSubpage] = React.useState<SettingsSubpage | null>('app')

  ensureMockElectronAPI()
  useSafeOpenUrlOverride()

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="h-full w-full max-w-[360px] border-r border-border/60 bg-background max-sm:max-w-none max-sm:border-r-0">
        <SettingsNavigator
          selectedSubpage={selectedSubpage}
          onSelectSubpage={setSelectedSubpage}
        />
      </aside>
      <main className="hidden min-w-0 flex-1 md:block" aria-hidden="true" />
    </div>
  )
}

const viewportIds: PlaygroundViewportPresetId[] = ['desktop', 'tablet', 'mobile']

export default viewportIds.map((viewportId) => definePlaygroundStory({
  id: `screen-settings-navigator-${viewportId}`,
  name: `Settings Navigator Screen (${PLAYGROUND_VIEWPORT_PRESETS[viewportId].name})`,
  category: 'Settings',
  level: 'Screens',
  description: 'Production SettingsNavigator with local selection state and suppressed window-opening actions.',
  component: SettingsNavigatorScreenStory,
  props: [],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS[viewportId],
}))
