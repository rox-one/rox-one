import { z } from 'zod'
import {
  COMPONENT_ID_RE,
  DESIGN_MANIFEST_LIMITS,
  DesignManifestSchema,
  type DesignManifest,
  type DesignModule,
  type JsonObject,
  type JsonValue,
} from './schema.ts'

export interface DesignManifestCompileOptions {
  /** The runtime-owned registry boundary. Values outside it are rejected fail-closed. */
  allowedComponentIds: ReadonlySet<string> | readonly string[]
  /**
   * The caller-owned theme boundary. Runtime bridge integration remains a separate
   * caller responsibility because this checkout does not include a Rox Design bridge.
   */
  allowedThemePresetIds: ReadonlySet<string> | readonly string[]
}

export class DesignManifestValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid design manifest: ${issues.join('; ')}`)
    this.name = 'DesignManifestValidationError'
    this.issues = issues
  }
}

function collectZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    return `${path}: ${issue.message}`
  })
}

function allowedIds(source: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return source instanceof Set ? source : new Set(source)
}

function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value && typeof value === 'object') {
    const normalized: JsonObject = {}
    for (const key of Object.keys(value).sort()) normalized[key] = normalizeJson(value[key]!)
    return normalized
  }
  return value
}

function normalizeModule(module: DesignModule): DesignModule {
  return {
    id: module.id,
    type: module.type,
    x: module.x,
    y: module.y,
    w: module.w,
    h: module.h,
    props: normalizeJson(module.props) as JsonObject,
  }
}

function compareModules(left: DesignModule, right: DesignModule): number {
  return left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)
}

/**
 * Validates, normalizes, and canonically orders an untrusted screen manifest.
 * It is intentionally pure: persistence, code generation, and component loading
 * remain responsibilities of the caller's privileged runtime.
 */
export function compileDesignManifest(raw: unknown, options: DesignManifestCompileOptions): DesignManifest {
  const parsed = DesignManifestSchema.safeParse(raw)
  if (!parsed.success) throw new DesignManifestValidationError(collectZodIssues(parsed.error))

  const allowedComponents = allowedIds(options.allowedComponentIds)
  const allowedThemePresets = allowedIds(options.allowedThemePresetIds)
  const issues: string[] = []
  const moduleIds = new Set<string>()

  if (!allowedThemePresets.has(parsed.data.theme.preset)) {
    issues.push(`theme.preset: theme preset "${parsed.data.theme.preset}" is not in the allowed theme preset registry`)
  }

  for (const [index, module] of parsed.data.modules.entries()) {
    const path = `modules.${index}`
    if (moduleIds.has(module.id)) issues.push(`${path}.id: duplicate module id "${module.id}"`)
    moduleIds.add(module.id)
    if (!COMPONENT_ID_RE.test(module.type) || !allowedComponents.has(module.type)) {
      issues.push(`${path}.type: component "${module.type}" is not in the allowed component registry`)
    }
    if (module.x + module.w > parsed.data.layout.columns) {
      issues.push(`${path}: module exceeds grid column bounds`)
    }
    if (module.y + module.h > DESIGN_MANIFEST_LIMITS.maxRows) {
      issues.push(`${path}: module exceeds grid row bounds`)
    }
  }

  if (issues.length > 0) throw new DesignManifestValidationError(issues)

  return {
    version: parsed.data.version,
    screen: {
      id: parsed.data.screen.id,
      title: parsed.data.screen.title,
      route: parsed.data.screen.route,
    },
    theme: { preset: parsed.data.theme.preset },
    layout: {
      type: parsed.data.layout.type,
      columns: parsed.data.layout.columns,
      rowHeight: parsed.data.layout.rowHeight,
      gap: parsed.data.layout.gap,
    },
    modules: parsed.data.modules
      .map((module) => normalizeModule({ ...module, props: module.props as JsonObject }))
      .sort(compareModules),
  }
}

/** A stable serialized representation suitable for hashing, snapshots, and transport. */
export function serializeDesignManifest(raw: unknown, options: DesignManifestCompileOptions): string {
  return JSON.stringify(compileDesignManifest(raw, options))
}

export function tryCompileDesignManifest(
  raw: unknown,
  options: DesignManifestCompileOptions,
): { ok: true; manifest: DesignManifest } | { ok: false; issues: readonly string[] } {
  try {
    return { ok: true, manifest: compileDesignManifest(raw, options) }
  } catch (error) {
    if (error instanceof DesignManifestValidationError) return { ok: false, issues: error.issues }
    return { ok: false, issues: [error instanceof Error ? error.message : String(error)] }
  }
}
