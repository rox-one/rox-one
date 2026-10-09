/**
 * G1 «Орбита» / Orbit — playground story for the flagged spatial board.
 *
 * File-discovered by `import.meta.glob('../../**\/*.playground.tsx')`, so no
 * registry index edit is needed. The board is rendered inside an isolated jotai
 * store hydrated with `featureOrbitBoardAtom = true`, mirroring the live mount
 * path in WorkspaceSurfaceHost. Two variants cover the light and dark theme.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { PLAYGROUND_VIEWPORT_PRESETS } from '@/playground/registry/types'
import { featureOrbitBoardAtom } from '@/atoms/unified-shell'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { cn } from '@/lib/utils'
import { OrbitBoard } from './OrbitBoard'

/** Seed the pilot flag inside the isolated store so the story is always ON. */
function HydrateOrbitFlag({ children }: { children: React.ReactNode }) {
  const setFlag = useSetAtom(featureOrbitBoardAtom)
  React.useEffect(() => {
    // The atom persists to the shared origin's localStorage: snapshot the
    // shipped value before the variant writes it and restore it on unmount, so
    // a QA run never leaves featureOrbitBoard ON for the real app.
    const key = getKeyString(KEYS.featureOrbitBoard)
    const previous = localStorage.getItem(key)
    setFlag(true)
    return () => {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  }, [setFlag])
  return <>{children}</>
}

function OrbitBoardStory({ mode }: { mode: 'light' | 'dark' }) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <JotaiProvider store={store}>
      <HydrateOrbitFlag>
        <div
          className={cn('h-full w-full', mode === 'dark' && 'dark')}
          style={{ background: 'var(--canvas)' }}
          data-demo="orbit-board"
        >
          <OrbitBoard />
        </div>
      </HydrateOrbitFlag>
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-orbit-board',
  name: 'Orbit Board',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G1 «Орбита» pilot: flagged spatial board of live-work cards — semantic zoom (мини / обзор / детали), pinned-satellite «орбита» ring on the focused card, minimap and the ⌘K «Прыжок» palette. Mounted with featureOrbitBoardAtom ON in an isolated store; flag OFF leaves the shipped panel stack untouched.',
  component: OrbitBoardStory,
  props: [
    {
      name: 'mode',
      description: 'Theme the board renders against',
      control: {
        type: 'select',
        options: [
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ],
      },
      defaultValue: 'light',
    },
  ],
  variants: [
    { name: 'Board — light', props: { mode: 'light' } },
    { name: 'Board — dark', props: { mode: 'dark' } },
  ],
  layout: 'full',
  viewport: PLAYGROUND_VIEWPORT_PRESETS.desktop,
})