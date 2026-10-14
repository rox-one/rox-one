/**
 * Glance-style widget registry: type → metadata, config schema, defaults and a
 * lazy loader. Each widget body is its own dynamic-import chunk, so the Home
 * entry bundle only carries this table and the page shell.
 */
import type * as React from 'react'
import type { GlanceConfig, GlanceWidgetInstance } from './model'

export type GlanceFieldKind = 'text' | 'textarea' | 'url' | 'number' | 'boolean' | 'select' | 'strings' | 'links'

export interface GlanceField {
  key: string
  kind: GlanceFieldKind
  labelKey: string
  hintKey?: string
  /** For `select`: value → i18n label key. */
  options?: readonly { value: string; labelKey: string }[]
  min?: number
  max?: number
  placeholder?: string
}

export interface GlanceWidgetProps {
  instance: GlanceWidgetInstance
  /** Config with defaults applied and types coerced. */
  config: GlanceConfig
  /** Rendered width of the card, px. */
  width: number
  /** Column the card lives in. */
  column: 'small' | 'full'
  /** Persist a new config for this instance (e.g. a to-do item toggled). */
  onConfig: (next: GlanceConfig) => void
}

export type GlanceCategory = 'rox' | 'essentials' | 'news' | 'media' | 'dev' | 'finance' | 'system' | 'advanced'

export interface GlanceWidgetDef {
  type: string
  category: GlanceCategory
  titleKey: string
  descriptionKey?: string
  icon: string
  defaultConfig: GlanceConfig
  fields: readonly GlanceField[]
  /** Fetches over the network (through the main process). */
  network?: boolean
  /** Body draws its own card (Rox dashboard widgets); the shell only adds edit chrome. */
  frameless?: boolean
  load: () => Promise<{ default: React.ComponentType<GlanceWidgetProps> }>
}

const registry = new Map<string, GlanceWidgetDef>()

export function registerGlanceWidget(def: GlanceWidgetDef): void {
  registry.set(def.type, def)
}

export function getGlanceWidget(type: string): GlanceWidgetDef | undefined {
  return registry.get(type)
}

export function listGlanceWidgets(): GlanceWidgetDef[] {
  return [...registry.values()]
}

export const GLANCE_CATEGORIES: readonly GlanceCategory[] = ['rox', 'essentials', 'news', 'media', 'dev', 'finance', 'system', 'advanced']

type Link = { title: string; url: string }

/** Only http(s) links survive; everything else (javascript:, file:, data:) is dropped. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Apply defaults and coerce every schema field; unknown keys are kept as-is. */
export function resolveConfig(def: GlanceWidgetDef, config: GlanceConfig): GlanceConfig {
  const out: GlanceConfig = { ...def.defaultConfig, ...config }
  for (const field of def.fields) {
    const fallback = def.defaultConfig[field.key]
    const v = out[field.key]
    switch (field.kind) {
      case 'text':
      case 'textarea':
        out[field.key] = typeof v === 'string' ? v : (fallback ?? '')
        break
      case 'url':
        out[field.key] = v === '' ? '' : (safeHttpUrl(v) ?? (typeof fallback === 'string' ? fallback : ''))
        break
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
        const base = Number.isFinite(n) ? n : typeof fallback === 'number' ? fallback : 0
        out[field.key] = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, base))
        break
      }
      case 'boolean':
        out[field.key] = typeof v === 'boolean' ? v : fallback === true
        break
      case 'select': {
        const allowed = field.options?.map((o) => o.value) ?? []
        out[field.key] = typeof v === 'string' && allowed.includes(v) ? v : (fallback ?? allowed[0] ?? '')
        break
      }
      case 'strings':
        out[field.key] = Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim()).slice(0, 100) : (Array.isArray(fallback) ? fallback : [])
        break
      case 'links':
        out[field.key] = Array.isArray(v)
          ? v
              .map((item): Link | null => {
                if (!item || typeof item !== 'object') return null
                const url = safeHttpUrl((item as Link).url)
                if (!url) return null
                const title = typeof (item as Link).title === 'string' && (item as Link).title.trim() ? (item as Link).title.trim() : new URL(url).hostname
                return { title, url }
              })
              .filter((l): l is Link => l !== null)
              .slice(0, 100)
          : (Array.isArray(fallback) ? fallback : [])
        break
    }
  }
  return out
}
