import type { ComponentType, ReactNode } from 'react'

export type ControlType =
  | { type: 'boolean' }
  | { type: 'string'; placeholder?: string }
  | { type: 'textarea'; placeholder?: string; rows?: number }
  | { type: 'number'; min?: number; max?: number; step?: number }
  | { type: 'select'; options: Array<{ label: string; value: string }> }

export interface PropDefinition {
  name: string
  description?: string
  control: ControlType
  defaultValue: unknown
}

export interface ComponentVariant {
  name: string
  description?: string
  props: Record<string, unknown>
}

/** The primary design-system layer represented by a playground story. */
export const PLAYGROUND_LEVELS = ['Tokens', 'Primitives', 'Patterns', 'Screens', 'Flows'] as const
export type PlaygroundLevel = typeof PLAYGROUND_LEVELS[number]

export interface PlaygroundViewportPreset {
  readonly id: string
  readonly name: string
  readonly width: number
  readonly height: number
}

export const PLAYGROUND_VIEWPORT_PRESETS = {
  desktop: { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
  laptop: { id: 'laptop', name: 'Laptop', width: 1280, height: 800 },
  tablet: { id: 'tablet', name: 'Tablet', width: 768, height: 1024 },
  mobile: { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
} as const satisfies Record<string, PlaygroundViewportPreset>

export type PlaygroundViewportPresetId = keyof typeof PLAYGROUND_VIEWPORT_PRESETS

export interface PlaygroundAppearanceConstraint {
  theme?: string
  mode?: 'light' | 'dark' | 'system'
}

export type Category = 'Sources' | 'Automations' | 'Mobile WebUI' | 'Onboarding' | 'Agent Setup' | 'Chat' | 'Island' | 'Browser' | 'Planner' | 'Custom Shadows' | 'Session List' | 'Collection' | 'Notes' | 'Kanban' | 'Entity Lists' | 'Edit Popover' | 'Turn Cards' | 'TurnCard Modes' | 'Fullscreen' | 'Chat Messages' | 'Chat Inputs' | 'Toast Messages' | 'Markdown' | 'Icons' | 'Settings' | 'Messaging' | 'Feedback' | 'OAuth' | 'Unified Shell' | 'Premium Menu'

/**
 * Playground stories are QA fixtures (ROX2-015). They must never claim a
 * completed live product action. queued/simulated/live are not valid here.
 */
export const PLAYGROUND_ROX2_RUN_STATE = 'fixture' as const
export type PlaygroundRox2RunState = typeof PLAYGROUND_ROX2_RUN_STATE

export type PlaygroundRox2Result = {
  ok: false
  state: PlaygroundRox2RunState
  code: 'playground.fixture'
  message: string
}

/** Story results are always fixture. Callers must not treat this as live. */
export function playgroundStoryResult(storyId: string): PlaygroundRox2Result {
  if (!storyId.trim()) throw new Error('playground story id is empty')
  return {
    ok: false,
    state: PLAYGROUND_ROX2_RUN_STATE,
    code: 'playground.fixture',
    message: `Playground story ${storyId} is a QA fixture, not a live product action`,
  }
}

export interface ComponentEntry {
  id: string
  name: string
  category: Category
  /**
   * Rox2 run state for this story. Playground cannot set `live`.
   * Defaults to `fixture` when omitted (ROX2-015).
   */
  rox2RunState?: PlaygroundRox2RunState
  /**
   * Design-system layer. Omitted by legacy registry entries and normalized to
   * `Patterns` by the registry loader.
   */
  level?: PlaygroundLevel
  description: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: ComponentType<any>
  props: PropDefinition[]
  variants?: ComponentVariant[]
  /** Returns mock data to merge with props (callbacks, complex objects) */
  mockData?: () => Record<string, unknown>
  /** Optional wrapper component for context providers */
  wrapper?: ComponentType<{ children: ReactNode }>
  /** Layout mode: 'centered' (default), 'top' for scrollable content, 'full' for full-height flex layout */
  layout?: 'centered' | 'top' | 'full'
  /** Optional preview overflow override for the component preview box */
  previewOverflow?: 'auto' | 'hidden' | 'visible'
  viewport?: PlaygroundViewportPreset
  appearance?: PlaygroundAppearanceConstraint
}

export interface CategoryGroup {
  name: Category
  components: ComponentEntry[]
}

export interface LevelGroup {
  name: PlaygroundLevel
  categories: CategoryGroup[]
}
