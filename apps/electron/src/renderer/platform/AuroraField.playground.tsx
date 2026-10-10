import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import { definePlaygroundStory } from '@/playground/registry/story-loader'
import { featureAuroraFieldAtom } from '@/atoms/unified-shell'
import { KEYS, getKeyString } from '@/lib/local-storage'
import { AuroraField } from './AuroraField'

/**
 * The aurora field's visual states. `mode` selects the hue set (light wash vs
 * dark glow); `degradation` stages the real `<html>` attribute that turns the
 * field off, so each variant exercises the shipped selectors rather than a
 * reimplementation. `low-power` stands in for the reduced-motion/transparency
 * path (the playground cannot emulate a media query).
 */
type AuroraMode = 'auto' | 'light' | 'dark'
type AuroraDegradation = 'none' | 'high-contrast' | 'scenic' | 'zen' | 'low-power'

interface AuroraFieldStoryProps {
  mode: AuroraMode
  degradation: AuroraDegradation
}

const ATTR_KEYS = ['data-contrast', 'data-scenic', 'data-shell-style', 'data-render-profile'] as const

const DEGRADATION_ATTRS: Record<AuroraDegradation, Partial<Record<(typeof ATTR_KEYS)[number], string>>> = {
  none: {},
  'high-contrast': { 'data-contrast': 'high' },
  scenic: { 'data-scenic': 'true' },
  zen: { 'data-shell-style': 'zen' },
  'low-power': { 'data-render-profile': 'performance' },
}

/** Hydrates the isolated store with the pilot flag ON, restoring storage on unmount. */
function HydrateAuroraFlag({ children }: { children: React.ReactNode }) {
  const setFlag = useSetAtom(featureAuroraFieldAtom)
  React.useEffect(() => {
    const key = getKeyString(KEYS.featureAuroraField)
    const previous = localStorage.getItem(key)
    setFlag(true)
    return () => {
      // The pilot flag ships OFF; never leave a QA fixture with it persisted ON.
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
    }
  }, [setFlag])
  return <>{children}</>
}

/**
 * Stages the variant on <html> for the lifetime of the story and restores the
 * captured baseline on unmount, so the degradation selectors
 * (`html[data-contrast="high"]`, …) and the `.dark` hue override apply exactly
 * as they do in the app.
 */
function useStagedRoot(mode: AuroraMode, degradation: AuroraDegradation) {
  const baseline = React.useRef<{ dark: boolean; attrs: Record<string, string | null> } | null>(null)

  React.useEffect(() => {
    const el = document.documentElement
    const attrs: Record<string, string | null> = {}
    for (const key of ATTR_KEYS) attrs[key] = el.getAttribute(key)
    baseline.current = { dark: el.classList.contains('dark'), attrs }
    return () => {
      const snapshot = baseline.current
      if (!snapshot) return
      for (const key of ATTR_KEYS) {
        const value = snapshot.attrs[key]
        if (value === null) el.removeAttribute(key)
        else el.setAttribute(key, value)
      }
      el.classList.toggle('dark', snapshot.dark)
    }
  }, [])

  React.useEffect(() => {
    const el = document.documentElement
    // 'auto' keeps the app's own light/dark (production behaviour); pinned
    // variants stage the class explicitly.
    if (mode !== 'auto') el.classList.toggle('dark', mode === 'dark')
    const staged = DEGRADATION_ATTRS[degradation]
    for (const key of ATTR_KEYS) {
      // Only manage attributes this variant explicitly stages; the app owns
      // data-contrast / scenic / zen / performance otherwise (the harness
      // reads them back to verify the shot).
      if (!(key in staged)) continue
      const value = staged[key]
      if (value === undefined || value === null) el.removeAttribute(key)
      else el.setAttribute(key, value)
    }
  }, [mode, degradation])
}

function AuroraFieldStory({ mode, degradation }: AuroraFieldStoryProps) {
  const store = React.useMemo(() => createStore(), [])
  useStagedRoot(mode, degradation)

  return (
    <JotaiProvider store={store}>
      <HydrateAuroraFlag>
        {/* `contain: paint` gives the fixed field a containing block, so it
            paints over this room's canvas instead of the whole window. */}
        <div
          className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-background"
          style={{ contain: 'paint' }}
          data-demo="aurora-field"
        >
          <AuroraField />
          <div className="relative z-raised flex flex-1 flex-col items-start justify-end gap-2 p-4">
            <span className="rounded-full border border-border-subtle bg-surface-elevated/70 px-2.5 py-1 text-xs text-muted-foreground">
              {`aurora · ${mode} · ${degradation}`}
            </span>
          </div>
        </div>
      </HydrateAuroraFlag>
    </JotaiProvider>
  )
}

export default definePlaygroundStory({
  id: 'screen-aurora-field',
  name: 'Aurora Field',
  category: 'Unified Shell',
  level: 'Screens',
  description:
    'Ambient aurora field (feature-aurora-field). Static gradient backdrop, flag hydrated ON; each variant stages the real html degradation attribute and restores it on unmount.',
  component: AuroraFieldStory,
  layout: 'full',
  props: [
    {
      name: 'mode',
      description: 'Field hue set (light wash / dark glow)',
      control: {
        type: 'select',
        options: [
          { label: 'Auto (follows theme)', value: 'auto' },
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' },
        ],
      },
      defaultValue: 'auto',
    },
    {
      name: 'degradation',
      description: 'Staged html degradation attribute',
      control: {
        type: 'select',
        options: [
          { label: 'None (field on)', value: 'none' },
          { label: 'High contrast', value: 'high-contrast' },
          { label: 'Scenic', value: 'scenic' },
          { label: 'Zen', value: 'zen' },
          { label: 'Low-power / reduced', value: 'low-power' },
        ],
      },
      defaultValue: 'none',
    },
  ],
  variants: [
    { name: 'Field — light', props: { mode: 'light', degradation: 'none' } },
    { name: 'Field — dark', props: { mode: 'dark', degradation: 'none' } },
    { name: 'Flat — high contrast', props: { mode: 'light', degradation: 'high-contrast' } },
    { name: 'Flat — scenic', props: { mode: 'dark', degradation: 'scenic' } },
    { name: 'Flat — zen', props: { mode: 'dark', degradation: 'zen' } },
    { name: 'Flat — reduced (low-power)', props: { mode: 'dark', degradation: 'low-power' } },
  ],
})