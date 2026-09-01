import { PLAYGROUND_LEVELS, type ComponentEntry, type CategoryGroup, type Category, type LevelGroup, type PlaygroundLevel } from './types'
import { normalizeDiscoveredPlaygroundStories, normalizePlaygroundStories } from './story-loader'
import { onboardingComponents } from './onboarding'
import { chatComponents } from './chat'
import { turnCardComponents, fullscreenOverlayComponents } from './turn-card'
import { turnCardModesComponents } from './turn-card-modes'
import { messagesComponents } from './messages'
import { inputComponents } from './input'
import { slashCommandComponents } from './slash-command'
import { markdownComponents } from './markdown'
import { iconComponents } from './icons'
import { oauthComponents } from './oauth'
import { toastsComponents } from './toasts'
import { sessionListComponents } from './session-list'
import { projectColorsComponents } from './project-colors'
import { editPopoverComponents } from './edit-popover'
import { automationComponents } from './automations'
import { entityListComponents } from './entity-lists'
import { browserUiComponents } from './browser-ui'
import { plannerComponents } from './planner'
import { customShadowsComponents } from './custom-shadows'
import { transportBannerComponents } from './transport-banner'
import { containerTransitionsComponents } from './container-transitions'
import { apiKeyInputComponents } from './api-key-input'
import { messagingComponents } from './messaging'
import { imageSupportComponents } from './image-support'
import { mobileWebUIComponents } from './mobile-webui'
import { kanbanComponents } from './kanban'
import { taskEditorComponents } from './task-editor'
import { unifiedShellComponents } from './unified-shell'

export * from './types'
export * from './story-loader'

// Vite resolves this at build time. Stories may live beside their production
// components anywhere under the renderer, so they do not need registry imports.
const discoveredStoryModules = import.meta.glob('../../**/*.playground.tsx', {
  eager: true,
})

const legacyComponentRegistry: ComponentEntry[] = [
  ...mobileWebUIComponents,
  ...apiKeyInputComponents,
  ...onboardingComponents,
  ...chatComponents,
  ...turnCardComponents,
  ...turnCardModesComponents,
  ...fullscreenOverlayComponents,
  ...messagesComponents,
  ...inputComponents,
  ...toastsComponents,
  ...slashCommandComponents,
  ...markdownComponents,
  ...iconComponents,
  ...oauthComponents,
  ...sessionListComponents,
  ...kanbanComponents,
  ...taskEditorComponents,
  ...projectColorsComponents,
  ...editPopoverComponents,
  ...automationComponents,
  ...entityListComponents,
  ...browserUiComponents,
  ...plannerComponents,
  ...customShadowsComponents,
  ...transportBannerComponents,
  ...containerTransitionsComponents,
  ...messagingComponents,
  ...imageSupportComponents,
  ...unifiedShellComponents,
]

export const componentRegistry: ComponentEntry[] = normalizePlaygroundStories([
  ...legacyComponentRegistry,
  ...normalizeDiscoveredPlaygroundStories(discoveredStoryModules),
])

function getCategoriesForLevel(level: PlaygroundLevel): CategoryGroup[] {
  const categoryOrder: Category[] = ['Sources', 'Automations', 'Mobile WebUI', 'Onboarding', 'Agent Setup', 'Chat', 'Island', 'Browser', 'Planner', 'Custom Shadows', 'Session List', 'Kanban', 'Entity Lists', 'Edit Popover', 'Turn Cards', 'TurnCard Modes', 'Fullscreen', 'Chat Messages', 'Chat Inputs', 'Toast Messages', 'Markdown', 'Icons', 'Settings', 'Messaging', 'Feedback', 'OAuth', 'Unified Shell']
  const categoryMap = new Map<Category, ComponentEntry[]>()

  for (const entry of componentRegistry) {
    if (entry.level !== level) continue
    const existing = categoryMap.get(entry.category) ?? []
    categoryMap.set(entry.category, [...existing, entry])
  }

  return categoryOrder
    .filter(name => categoryMap.has(name))
    .map(name => ({
      name,
      components: categoryMap.get(name)!,
    }))
}

/** Groups current and file-discovered stories by their design-system layer. */
export function getCategories(): LevelGroup[] {
  // Keep all five levels present from day one. Empty layers are intentional:
  // they make the migration target visible while existing registry entries
  // continue to normalize to `Patterns`.
  return PLAYGROUND_LEVELS.map(name => ({ name, categories: getCategoriesForLevel(name) }))
}

export function getComponentById(id: string): ComponentEntry | undefined {
  return componentRegistry.find(c => c.id === id)
}
