/**
 * Rovers catalog v1 — zod validation.
 *
 * The catalog is a trust input: it is parsed once at load and every consumer
 * (session tools, `rovers:list` RPC) reads the validated object. Anything that
 * does not match the v1 contract fails closed with a {@link RoversCatalogError}
 * carrying the individual zod issues — never a partially-applied catalog.
 */

import { z } from 'zod'

import type { RoversCatalog } from './types.ts'

/** Kebab-case id: the icon stem and the `rovers_show` key. */
const ID_RE = /^[a-z0-9][a-z0-9-]*$/

const localizedSchema = z.object({
  ru: z.string().min(1, 'ru text is required'),
  en: z.string().min(1, 'en text is required'),
})

/** One catalog entry — extra keys are rejected so the wire shape cannot drift. */
export const roversEntrySchema = z
  .object({
    id: z.string().regex(ID_RE, 'id must be kebab-case ([a-z0-9-])'),
    name: z.string().min(1),
    category: z.string().min(1),
    tagline: localizedSchema,
    description: localizedSchema,
    icon: z.string().min(1),
    spdx: z.string().min(1),
    homepage: z.string(),
    verified: z.boolean(),
    deploy: z.object({ kind: z.literal('none') }),
  })
  .strict()

/** The full catalog body. `version` is pinned to the v1 contract. */
export const roversCatalogSchema = z
  .object({
    version: z.literal(1),
    generated_at: z.string().min(1),
    source: z
      .object({
        repo: z.string().min(1),
        commit: z.string().min(1),
      })
      .strict(),
    entries: z.array(roversEntrySchema),
  })
  .strict()

/** Thrown for any structural catalog violation. `issues` is human-readable. */
export class RoversCatalogValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid Rovers catalog: ${issues.join('; ')}`)
    this.name = 'RoversCatalogValidationError'
    this.issues = issues
  }
}

/**
 * Validate an already-JSON-parsed catalog body. Throws
 * {@link RoversCatalogValidationError} on any schema violation, structural
 * violation, or duplicate `id` (ids are the stable address of an entry).
 */
export function parseRoversCatalog(raw: unknown): RoversCatalog {
  const parsed = roversCatalogSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.')
      return `${path || '(root)'}: ${issue.message}`
    })
    throw new RoversCatalogValidationError(issues)
  }

  const catalog = parsed.data as RoversCatalog
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const entry of catalog.entries) {
    if (seen.has(entry.id)) duplicates.add(entry.id)
    else seen.add(entry.id)
  }
  if (duplicates.size > 0) {
    throw new RoversCatalogValidationError([`duplicate entry id(s): ${[...duplicates].join(', ')}`])
  }
  return catalog
}