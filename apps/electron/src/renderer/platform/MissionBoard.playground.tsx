/**
 * Playground story: `screen-missions-board` — the G3 «Миссии» board surface.
 *
 * File-discovered (`*.playground.tsx`); no registry edits. Hydrates an
 * isolated jotai store with the feature flag and mock session metadata, and
 * mirrors the flag into the shared route gate so the mission rows behave as
 * they do in the app. Variants: populated / empty / flag OFF.
 */
import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { NavigationProvider } from '@/contexts/NavigationContext'
import { MissionBoard } from '@/platform/MissionBoard'
import { featureMissionsBoardV1Atom } from '@/atoms/unified-shell'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { setMissionsRoutesEnabled, resetMissionsRoutesEnabled } from '../../shared/route-parser'
import { definePlaygroundStory } from '@/playground/registry/story-loader'

const DEMO_WORKSPACE_ID = 'playground-missions'

function mockMeta(input: Partial<SessionMeta> & { id: string; projectId?: string }): SessionMeta {
  return {
    workspaceId: DEMO_WORKSPACE_ID,
    createdAt: Date.now() - 120_000,
    lastMessageAt: Date.now(),
    ...input,
  } as SessionMeta
}

const DEMO_SESSIONS: SessionMeta[] = [
  mockMeta({ id: 's-bundle', name: 'Bundle split', projectId: 'rel-24', isProcessing: true }),
  mockMeta({ id: 's-changelog', name: 'Changelog draft', projectId: 'rel-24', hasUnread: true }),
  mockMeta({ id: 's-signoff', name: 'Release sign-off', projectId: 'rel-24' }),
  mockMeta({ id: 's-onboarding', name: 'Fix onboarding step 3', projectId: 'onboarding-fix', hasUnread: true }),
  mockMeta({ id: 's-adhoc', name: 'Ad-hoc Q&A' }),
]

interface HydrateProps {
  enabled: boolean
  populated: boolean
  children: React.ReactNode
}

/** Sets the flag + session metadata in the isolated store, per variant. */
function Hydrate({ enabled, populated, children }: HydrateProps) {
  const setFlag = useSetAtom(featureMissionsBoardV1Atom)
  const setMetaMap = useSetAtom(sessionMetaMapAtom)

  // The flag atom persists to the shared origin's localStorage: snapshot the
  // shipped value before any variant writes it and restore it on unmount, so a
  // QA run never leaves featureMissionsBoardV1 ON for the real app. Declared
  // first so it captures the value before the variant effect below writes.
  React.useEffect(() => {
    const key = getKeyString(KEYS.featureMissionsBoardV1)
    const previous = localStorage.getItem(key)
    return () => {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  }, [])

  React.useEffect(() => {
    setFlag(enabled)
    setMetaMap(populated ? new Map(DEMO_SESSIONS.map((meta) => [meta.id, meta])) : new Map())
    setMissionsRoutesEnabled(enabled)
    return () => resetMissionsRoutesEnabled()
  }, [enabled, populated, setFlag, setMetaMap])

  return <>{children}</>
}

export interface MissionBoardDemoProps {
  enabled: boolean
  populated: boolean
}

function MissionBoardDemo({ enabled, populated }: MissionBoardDemoProps) {
  const store = React.useMemo(() => createStore(), [])
  const onCreateSession = React.useCallback(async () => {
    throw new Error('playground demo: session creation is not wired')
  }, [])

  return (
    <JotaiProvider store={store}>
      <Hydrate enabled={enabled} populated={populated}>
        <NavigationProvider
          workspaceId={DEMO_WORKSPACE_ID}
          workspaceSlug="playground"
          onCreateSession={onCreateSession}
          isReady
          isSessionsReady
        >
          <div
            className="h-[560px] w-full overflow-hidden rounded-lg border border-border bg-background"
            data-demo="missions-board"
          >
            <MissionBoard />
          </div>
        </NavigationProvider>
      </Hydrate>
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-missions-board',
  name: 'MissionBoard',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'G3 «Миссии» board: derived missions grouped by projectId, lane chips with live session state, counters and the empty state. Flag OFF renders the off-state.',
  component: MissionBoardDemo,
  layout: 'full',
  props: [
    { name: 'enabled', description: 'featureMissionsBoardV1Atom (default OFF)', control: { type: 'boolean' }, defaultValue: true },
    { name: 'populated', description: 'Seed mock sessions (off = empty state)', control: { type: 'boolean' }, defaultValue: true },
  ],
  variants: [
    { name: 'Populated (flag ON)', props: { enabled: true, populated: true } },
    { name: 'Empty (flag ON)', props: { enabled: true, populated: false } },
    { name: 'Flag OFF', props: { enabled: false, populated: true } },
  ],
})