import * as React from 'react'
import type { CSSProperties } from 'react'
import type { TFunction } from "i18next"
import type { StatusConfig } from '@craft-agent/shared/statuses'
import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'
import { isEmoji } from '@craft-agent/shared/utils/icon-constants'
import { resolveEntityColor, getDefaultStatusColor } from '@craft-agent/shared/colors'
import type { EntityColor } from '@craft-agent/shared/colors'
import { StatusIcon } from '@/components/ui/status-icon'
import { iconCache } from '@/lib/icon-cache'

// ============================================================================
// Types
// ============================================================================

// Dynamic status ID (any string now)
export type SessionStatusId = string

export interface SessionStatusConfig {
  id: string
  label: string
  color?: EntityColor
}

export interface SessionStatus extends SessionStatusConfig {
  /**
   * Resolved CSS color string for inline style application.
   * System colors resolve to var(--name) or color-mix(...).
   * Custom colors resolve to the appropriate light/dark hex value.
   */
  resolvedColor: string
  icon: React.ReactNode
  /**
   * Whether the icon responds to color styling (uses currentColor).
   * - true: SVGs with currentColor - apply status color
   * - false: Emojis, images, SVGs with hardcoded colors - render at full opacity
   */
  iconColorable: boolean
  category?: 'open' | 'closed'
  isFixed?: boolean
  isDefault?: boolean
}

// ============================================================================
// Status → SessionStatus Conversion
// ============================================================================

/**
 * Convert StatusConfig to SessionStatus.
 * Resolves EntityColor to a CSS color string for inline style use.
 * System colors (e.g., "accent") resolve to CSS variable references that
 * auto-adapt to light/dark theme. Custom colors use isDark to pick the right value.
 *
 * Colorability is determined synchronously:
 * - Emoji icons → not colorable (they have their own colors)
 * - Everything else (SVGs, fallback) → colorable (uses currentColor)
 */
export function statusConfigToSessionStatus(
  config: StatusConfig,
  workspaceId: string,
  isDark: boolean
): SessionStatus {
  // Emojis have their own colors and don't respond to CSS color inheritance.
  // SVGs with currentColor and the fallback Circle icon are colorable.
  const iconColorable = !isEmoji(config.icon)

  // Resolve EntityColor → CSS color string for inline style
  const entityColor = config.color ?? getDefaultStatusColor(config.id)
  const resolvedColor = resolveEntityColor(entityColor, isDark)

  return {
    id: config.id,
    label: config.label,
    color: config.color,
    resolvedColor,
    icon: (
      <StatusIcon
        statusId={config.id}
        icon={config.icon}
        workspaceId={workspaceId}
        size="xs"
        chromeless={!iconColorable}
      />
    ),
    iconColorable,
    category: config.category,
    isFixed: config.isFixed,
    isDefault: config.isDefault,
  }
}

/**
 * Convert array of StatusConfig to SessionStatus[]
 */
export function statusConfigsToSessionStatuses(
  configs: StatusConfig[],
  workspaceId: string,
  isDark: boolean
): SessionStatus[] {
  return configs.map(c => statusConfigToSessionStatus(c, workspaceId, isDark))
}

// ============================================================================
// Default Status IDs & i18n Display Resolution
// ============================================================================

/**
 * IDs of the built-in default statuses that ship with every workspace.
 * These are the only statuses that receive i18n translation — user-created
 * or renamed statuses are always displayed as-is.
 */
export const DEFAULT_STATUS_IDS = new Set([
  'backlog',
  'todo',
  'in-progress',
  'needs-review',
  'done',
  'cancelled',
])

function englishCatalog(key: string): string | undefined {
  const value = LOCALE_REGISTRY.en.messages[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function matchesEnglishSeed(key: string, persisted: string | undefined): boolean {
  const seed = englishCatalog(key)
  return seed !== undefined && persisted === seed
}

/**
 * Catalog hit → translated string. Catalog miss → user label if present,
 * else identifier. Never the raw `status.<id>` (or sibling) key.
 */
function catalogOrFallback(
  t: TFunction,
  key: string,
  userLabel: string | undefined,
  identifier: string,
): string {
  const translated = t(key)
  if (typeof translated === 'string' && translated.length > 0 && translated !== key) {
    return translated
  }
  const trimmed = userLabel?.trim()
  return trimmed || identifier
}

/**
 * Resolve the display label for a status, respecting user customizations.
 *
 * Built-in statuses translate when the persisted label still matches the
 * English catalog seed. Custom statuses or renamed defaults stay as-is.
 */
export function resolveStatusDisplayLabel(
  state: { id: string; label: string },
  t: TFunction,
): string {
  const key = `status.${state.id}`
  if (DEFAULT_STATUS_IDS.has(state.id) && matchesEnglishSeed(key, state.label)) {
    return catalogOrFallback(t, key, state.label, state.id)
  }
  return state.label?.trim() || state.id
}

/**
 * Resolve the display name for a label, respecting user customizations.
 *
 * Built-in default labels translate when the persisted name still matches
 * the English catalog seed. Custom labels or renamed defaults stay as-is.
 */
export function resolveLabelDisplayName(
  label: { id: string; name: string },
  t: TFunction,
): string {
  const key = `label.default.${label.id}`
  if (matchesEnglishSeed(key, label.name)) {
    return catalogOrFallback(t, key, label.name, label.id)
  }
  return label.name?.trim() || label.id
}

// ============================================================================
// Helper Functions (updated to work with dynamic states)
// ============================================================================

/**
 * Get the icon for a todo state
 */

const DEFAULT_VIEW_PURPOSE_KEYS: Record<string, string> = {
  'view-new': 'sidebar.view.overviewPurpose',
  'view-plan': 'sidebar.view.planPurpose',
  'view-processing': 'sidebar.view.processPurpose',
}

function viewCatalogSlug(viewId: string): string {
  return viewId.replace(/^view-/, '')
}

/**
 * Resolve the display name for a built-in session view.
 * Translates only when the persisted name still equals the English catalog seed.
 */
export function resolveViewDisplayName(
  view: { id: string; name: string },
  t: TFunction,
): string {
  const key = `sidebar.view.${viewCatalogSlug(view.id)}`
  if (matchesEnglishSeed(key, view.name)) {
    return catalogOrFallback(t, key, view.name, view.id)
  }
  return view.name?.trim() || view.id
}

/** Resolve tooltip/description for a built-in session view when still seeded. */
export function resolveViewDisplayDescription(
  view: { id: string; description?: string },
  t: TFunction,
): string | undefined {
  const descKey = `sidebar.view.${viewCatalogSlug(view.id)}Desc`
  const purposeKey = DEFAULT_VIEW_PURPOSE_KEYS[view.id]
  const catalogKey = purposeKey ?? descKey
  const shouldTranslate =
    !view.description || matchesEnglishSeed(descKey, view.description)
  if (!shouldTranslate) return view.description
  const translated = t(catalogKey)
  if (typeof translated === 'string' && translated.length > 0 && translated !== catalogKey) {
    return translated
  }
  const trimmed = view.description?.trim()
  return trimmed || undefined
}

export function getStateIcon(
  stateId: string,
  states: SessionStatus[]
): React.ReactNode {
  const state = states.find(s => s.id === stateId)
  return state?.icon ?? <span className="h-3.5 w-3.5">●</span>
}

/**
 * Return inline style for a status icon only when the icon is colorable.
 *
 * Colorable icons (SVG/currentColor) receive the resolved status color.
 * Non-colorable icons (emoji/images) return undefined so they render at full native color/opacity.
 */
export function getStatusIconStyle(state?: SessionStatus): CSSProperties | undefined {
  return state?.iconColorable ? { color: state.resolvedColor } : undefined
}

/**
 * Resolve a status by ID and return icon style only when color should be applied.
 */
export function getStateIconStyle(
  stateId: string,
  states: SessionStatus[]
): CSSProperties | undefined {
  return getStatusIconStyle(states.find(s => s.id === stateId))
}

/**
 * Get the resolved CSS color for a todo state (ready for inline style)
 */
export function getStateColor(
  stateId: string,
  states: SessionStatus[]
): string | undefined {
  return states.find(s => s.id === stateId)?.resolvedColor
}

/**
 * Get the label for a todo state
 */
export function getStateLabel(
  stateId: string,
  states: SessionStatus[]
): string {
  const state = states.find(s => s.id === stateId)
  return state?.label ?? stateId
}

/**
 * Get a complete state object by ID
 */
export function getState(
  stateId: string,
  states: SessionStatus[]
): SessionStatus | undefined {
  return states.find(s => s.id === stateId)
}

/**
 * Clear status icon cache (useful when statuses are updated).
 * Clears status-prefixed entries from the unified icon cache.
 */
export function clearIconCache(): void {
  for (const key of iconCache.keys()) {
    if (key.startsWith('status:')) iconCache.delete(key)
  }
}
