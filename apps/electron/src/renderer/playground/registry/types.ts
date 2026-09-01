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
  /** Stable identifier for the preset, suitable for stories and test selectors. */
  readonly id: string
  /** Human-readable name shown in the preview toolbar. */
  readonly name: string
  readonly width: number
  readonly height: number
}

/** Named, reusable viewport presets for stories that need layout context. */
export const PLAYGROUND_VIEWPORT_PRESETS = {
  desktop: { id: 'desktop', name: 'Desktop', width: 1440, height: 900 },
  laptop: { id: 'laptop', name: 'Laptop', width: 1280, height: 800 },
  tablet: { id: 'tablet', name: 'Tablet', width: 768, height: 1024 },
  mobile: { id: 'mobile', name: 'Mobile', width: 390, height: 844 },
} as const satisfies Record<string, PlaygroundViewportPreset>

export type PlaygroundViewportPresetId = keyof typeof PLAYGROUND_VIEWPORT_PRESETS

/** Optional visual conditions required to review a story faithfully. */
export interface PlaygroundAppearanceConstraint {
  /** Preset color theme id expected by the story. */
  theme?: string
  /** Theme mode expected by the story. `system` intentionally remains valid. */
  mode?: 'light' | 'dark' | 'system'
}

export type Category = 'Sources' | 'Automations' | 'Mobile WebUI' | 'Onboarding' | 'Agent Setup' | 'Chat' | 'Island' | 'Browser' | 'Planner' | 'Custom Shadows' | 'Session List' | 'Kanban' | 'Entity Lists' | 'Edit Popover' | 'Turn Cards' | 'TurnCard Modes' | 'Fullscreen' | 'Chat Messages' | 'Chat Inputs' | 'Toast Messages' | 'Markdown' | 'Icons' | 'Settings' | 'Messaging' | 'Feedback' | 'OAuth' | 'Unified Shell'

export interface ComponentEntry {
  id: string
  name: string
  category: Category
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
  /** Named viewport used to review responsive or screen-level stories. */
  viewport?: PlaygroundViewportPreset
  /** Optional visual constraints documented by the story author. */
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
