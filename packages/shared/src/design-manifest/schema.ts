import { z } from 'zod'

/** The only manifest version accepted by this compiler revision. */
export const DESIGN_MANIFEST_VERSION = 1 as const

/** Hard caps keep an untrusted manifest from becoming an accidental render DoS. */
export const DESIGN_MANIFEST_LIMITS = {
  maxColumns: 64,
  maxRows: 10_000,
  maxModules: 128,
  maxPropsDepth: 24,
  maxPropsNodes: 10_000,
} as const

export const SCREEN_ID_RE = /^[a-z0-9][a-z0-9-]*$/
export const ROUTE_RE = /^[a-z0-9][a-z0-9/-]*$/
export const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]*$/
export const COMPONENT_ID_RE = /^[A-Za-z][A-Za-z0-9]*$/
export const THEME_PRESET_RE = /^[a-z0-9][a-z0-9-]*$/

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

const unsafeObjectKeys = new Set(['__proto__', 'constructor', 'prototype'])

function findNonJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  state: { nodes: number },
  depth: number,
): string | undefined {
  state.nodes += 1
  if (state.nodes > DESIGN_MANIFEST_LIMITS.maxPropsNodes) {
    return `${path} exceeds the ${DESIGN_MANIFEST_LIMITS.maxPropsNodes}-node limit`
  }
  if (depth > DESIGN_MANIFEST_LIMITS.maxPropsDepth) {
    return `${path} exceeds the ${DESIGN_MANIFEST_LIMITS.maxPropsDepth}-level depth limit`
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : `${path} must not contain a non-finite number`
  }
  if (typeof value !== 'object') return `${path} must be JSON-safe, not ${typeof value}`
  if (ancestors.has(value)) return `${path} must not contain a circular reference`

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    return `${path} must contain plain objects only`
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return `${path} must not contain symbol keys`
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const issue = findNonJsonValue(value[index], `${path}[${index}]`, ancestors, state, depth + 1)
        if (issue) return issue
      }
      return undefined
    }

    const objectValue = value as Record<string, unknown>
    for (const key of Object.keys(objectValue)) {
      if (unsafeObjectKeys.has(key)) return `${path}.${key} is not allowed`
      const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
      if (!descriptor || descriptor.get || descriptor.set) return `${path}.${key} must not be an accessor property`
      const issue = findNonJsonValue(objectValue[key], `${path}.${key}`, ancestors, state, depth + 1)
      if (issue) return issue
    }
    return undefined
  } finally {
    ancestors.delete(value)
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return !findNonJsonValue(value, 'props', new WeakSet(), { nodes: 0 }, 0)
}

/** JSON-only props: no JSX, functions, class instances, symbols, or unsafe object keys. */
export const JsonPropsSchema = z.unknown().superRefine((value, ctx) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'props must be a JSON object' })
    return
  }
  const issue = findNonJsonValue(value, 'props', new WeakSet(), { nodes: 0 }, 0)
  if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})

const ScreenSchema = z.object({
  id: z.string().regex(SCREEN_ID_RE, 'screen.id must be a lowercase kebab-case identifier'),
  title: z.string().trim().min(1).max(200),
  route: z.string().regex(ROUTE_RE, 'screen.route must be a lowercase route identifier'),
}).strict()

const ThemeSchema = z.object({
  preset: z.string().regex(THEME_PRESET_RE, 'theme.preset must be a lowercase kebab-case identifier'),
}).strict()

export const GridLayoutSchema = z.object({
  type: z.literal('grid'),
  columns: z.number().int().min(1).max(DESIGN_MANIFEST_LIMITS.maxColumns),
  rowHeight: z.number().int().min(1).max(DESIGN_MANIFEST_LIMITS.maxRows),
  gap: z.number().int().min(0).max(256),
}).strict()

export const DesignModuleSchema = z.object({
  id: z.string().regex(MODULE_ID_RE, 'module.id must be a lowercase kebab-case identifier'),
  type: z.string().regex(COMPONENT_ID_RE, 'module.type must be a safe component identifier'),
  x: z.number().int().min(0).max(DESIGN_MANIFEST_LIMITS.maxColumns - 1),
  y: z.number().int().min(0).max(DESIGN_MANIFEST_LIMITS.maxRows - 1),
  w: z.number().int().min(1).max(DESIGN_MANIFEST_LIMITS.maxColumns),
  h: z.number().int().min(1).max(DESIGN_MANIFEST_LIMITS.maxRows),
  props: JsonPropsSchema.default({}),
}).strict()

/** Structural validation. Component availability is checked by compileDesignManifest. */
export const DesignManifestSchema = z.object({
  version: z.literal(DESIGN_MANIFEST_VERSION),
  screen: ScreenSchema,
  theme: ThemeSchema,
  layout: GridLayoutSchema,
  modules: z.array(DesignModuleSchema).min(1).max(DESIGN_MANIFEST_LIMITS.maxModules),
}).strict()

export type DesignManifestInput = z.input<typeof DesignManifestSchema>

export interface GridLayout {
  type: 'grid'
  columns: number
  rowHeight: number
  gap: number
}

export interface DesignModule {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  props: JsonObject
}

export interface DesignManifest {
  version: typeof DESIGN_MANIFEST_VERSION
  screen: {
    id: string
    title: string
    route: string
  }
  theme: {
    preset: string
  }
  layout: GridLayout
  modules: DesignModule[]
}

export function isJsonProps(value: unknown): value is JsonObject {
  return isJsonObject(value)
}
