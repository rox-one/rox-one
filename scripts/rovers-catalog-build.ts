#!/usr/bin/env bun
/**
 * Rovers catalog build — derive the flat, signed catalog.json v1 for Slice A.
 *
 * Source of truth: rox-rovers `CatalogApp` manifests
 *   $ROX_ROVERS_REPO/catalog/entries/<id>.yaml   (77 curated services)
 * with a fallback to `$ROX_ROVERS_REPO/catalog/examples/*.yaml` while the
 * entries directory is still being produced. Manifests are the authoring form
 * (catalog/SCHEMA.md); the flat v1 catalog is the shipping form the renderer
 * consumes (binding cross-slice contract §1):
 *
 *   id          = metadata.slug
 *   name        = metadata.displayName.en (brand string; ru is identical)
 *   category    = metadata.category
 *   tagline     = metadata.summary            (locale map { ru, en })
 *   description = metadata.description        (locale map { ru, en }; falls back to summary)
 *   icon        = "icons/<id>.svg"
 *   spdx        = spec.license.spdx (or NOASSERTION)
 *   homepage    = spec.source.repo
 *   verified    = !metadata.tags.includes("unverified")
 *   deploy      = { kind: "none" }            (no deploy engine on this slice)
 *
 * Output: apps/electron/resources/rovers/{catalog.json,catalog.json.sig,catalog.json.sha256}
 * plus icons/<id>.svg (copied from $ROX_ROVERS_REPO/icons/, or a monogram
 * placeholder when the source icon is missing).
 *
 * Signing reuses the existing marketplace machinery
 * (packages/shared/src/marketplace/catalog-signing.ts). Without
 * CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY or scripts/.marketplace-catalog-signing-key.b64
 * the .sig is not written (mirrors scripts/marketplace-content-sha.ts); the
 * runtime loader treats an unsigned bundled catalog as an error, so dev runs use
 * the ROX_ROVERS_CATALOG_PATH override until the artifact is signed.
 *
 * Idempotent: entry order is sorted by id and a re-run that derives identical
 * entries + source keeps the previously written generated_at, so integration
 * regens do not churn the artifact.
 *
 * Usage: bun run scripts/rovers-catalog-build.ts
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

import { signCatalogBody } from '../packages/shared/src/marketplace/catalog-signing.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..')

/** Authoring repo (contract §1 header `source.repo`). */
const SOURCE_REPO = 'agisota/2026-10-09-rox-rovers'
const ROX_ROVERS_REPO = process.env.ROX_ROVERS_REPO?.trim() || '/Users/t/Projects/2026-10-09-rox-rovers'
const OUT_DIR = join(REPO_ROOT, 'apps', 'electron', 'resources', 'rovers')
const ICONS_OUT = join(OUT_DIR, 'icons')

// ---------------------------------------------------------------------------
// Monogram palette — one hue per catalog category (honest placeholder icons).
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  'llm-runtime': '#4f46e5',
  gateway: '#0d9488',
  'chat-ui': '#db2777',
  'vector-db': '#7c3aed',
  database: '#2563eb',
  'object-storage': '#0284c7',
  automation: '#ea580c',
  observability: '#16a34a',
  'dev-env': '#475569',
  media: '#c026d3',
  comms: '#0891b2',
  'agent-tooling': '#65a30d',
  'rox-ecosystem': '#b45309',
}

interface LocalizedText {
  ru: string
  en: string
}

interface RoversEntryV1 {
  id: string
  name: string
  category: string
  tagline: LocalizedText
  description: LocalizedText
  icon: string
  spdx: string
  homepage: string
  verified: boolean
  deploy: { kind: 'none' }
}

interface CatalogHeader {
  version: 1
  generated_at: string
  source: { repo: string; commit: string }
}

interface CatalogAppManifest {
  kind?: unknown
  metadata?: {
    slug?: unknown
    displayName?: unknown
    summary?: unknown
    description?: unknown
    category?: unknown
    tags?: unknown
    icon?: unknown
  }
  spec?: {
    source?: { repo?: unknown }
    license?: { spdx?: unknown }
  }
}

function warn(message: string): void {
  console.warn(`rovers-catalog: ${message}`)
}

function localized(value: unknown, fallback?: LocalizedText): LocalizedText | null {
  if (typeof value === 'string' && value.trim()) return { ru: value.trim(), en: value.trim() }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const ru = typeof record.ru === 'string' && record.ru.trim() ? record.ru.trim() : undefined
  const en = typeof record.en === 'string' && record.en.trim() ? record.en.trim() : undefined
  const resolvedRu = ru ?? en ?? fallback?.ru
  const resolvedEn = en ?? ru ?? fallback?.en
  if (!resolvedRu || !resolvedEn) return null
  return { ru: resolvedRu, en: resolvedEn }
}

function deriveEntry(manifest: CatalogAppManifest, file: string): RoversEntryV1 | null {
  const metadata = manifest.metadata
  const slug = typeof metadata?.slug === 'string' ? metadata.slug.trim() : ''
  if (!slug) {
    warn(`skipping ${basename(file)}: metadata.slug is missing`)
    return null
  }

  const display = localized(metadata?.displayName)
  const summary = localized(metadata?.summary)
  const category = typeof metadata?.category === 'string' ? metadata.category.trim() : ''
  if (!display || !summary || !category) {
    warn(`skipping ${basename(file)}: displayName/summary/category incomplete`)
    return null
  }

  const description = localized(metadata?.description, summary) ?? summary
  const tags: unknown[] = Array.isArray(metadata?.tags) ? metadata.tags : []
  const icon = typeof metadata?.icon === 'string' && metadata.icon.trim() ? metadata.icon.trim() : `icons/${slug}.svg`
  const spdx = typeof manifest.spec?.license?.spdx === 'string' && manifest.spec.license.spdx.trim()
    ? manifest.spec.license.spdx.trim()
    : 'NOASSERTION'
  const homepage = typeof manifest.spec?.source?.repo === 'string' ? manifest.spec.source.repo.trim() : ''

  return {
    id: slug,
    name: display.en,
    category,
    tagline: { ru: summary.ru.slice(0, 120), en: summary.en.slice(0, 120) },
    description,
    icon,
    spdx,
    homepage,
    verified: !tags.includes('unverified'),
    deploy: { kind: 'none' },
  }
}

function readEntries(): { entries: RoversEntryV1[]; dir: string } {
  const entriesDir = join(ROX_ROVERS_REPO, 'catalog', 'entries')
  const examplesDir = join(ROX_ROVERS_REPO, 'catalog', 'examples')
  const yamlFiles = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
          .sort()
      : []

  const hasEntries = yamlFiles(entriesDir).length > 0
  const dir = hasEntries ? entriesDir : examplesDir
  if (!hasEntries) warn(`catalog/entries is empty — falling back to ${dir}`)

  const entries: RoversEntryV1[] = []
  for (const name of yamlFiles(dir)) {
    const file = join(dir, name)
    let parsed: CatalogAppManifest
    try {
      parsed = parseYaml(readFileSync(file, 'utf8')) as CatalogAppManifest
    } catch (error) {
      warn(`skipping ${name}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const entry = deriveEntry(parsed, file)
    if (entry) entries.push(entry)
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { entries, dir }
}

function resolveCommit(): string {
  try {
    const result = Bun.spawnSync(['git', '-C', ROX_ROVERS_REPO, 'rev-parse', 'HEAD'])
    const sha = new TextDecoder().decode(result.stdout).trim()
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Reuse the previous generated_at when the derived content is unchanged (idempotent regen). */
function resolveGeneratedAt(header: { source: { commit: string } }, entries: RoversEntryV1[]): string {
  const override = process.env.ROX_ROVERS_CATALOG_GENERATED_AT?.trim()
  if (override) return override
  const existingPath = join(OUT_DIR, 'catalog.json')
  if (existsSync(existingPath)) {
    try {
      const previous = JSON.parse(readFileSync(existingPath, 'utf8')) as Partial<CatalogHeader> & { entries?: unknown }
      const sameEntries = JSON.stringify(previous.entries) === JSON.stringify(entries)
      const sameSource = previous.source?.repo === SOURCE_REPO && previous.source?.commit === header.source.commit
      if (sameEntries && sameSource && typeof previous.generated_at === 'string') return previous.generated_at
    } catch {
      // Corrupt previous artifact — regenerate fresh.
    }
  }
  return new Date().toISOString()
}

function monogramSvg(entry: RoversEntryV1): string {
  const letter = (entry.name.trim()[0] ?? entry.id[0] ?? '?').toUpperCase()
  const color = CATEGORY_COLORS[entry.category] ?? '#475569'
  const escaped = letter.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img">',
    `  <title>${escaped}</title>`,
    '  <rect width="96" height="96" rx="22" fill="#111827"/>',
    `  <rect x="6" y="6" width="84" height="84" rx="18" fill="${color}"/>`,
    `  <text x="48" y="49" text-anchor="middle" dominant-baseline="central" fill="#f9fafb"`,
    '        font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="44" font-weight="600">',
    `    ${escaped}`,
    '  </text>',
    '</svg>',
    '',
  ].join('\n')
}

function stageIcons(entries: RoversEntryV1[]): number {
  mkdirSync(ICONS_OUT, { recursive: true })
  let placeholders = 0
  for (const entry of entries) {
    const target = join(ICONS_OUT, `${entry.id}.svg`)
    const source = join(ROX_ROVERS_REPO, entry.icon.startsWith('icons/') ? entry.icon : `icons/${entry.id}.svg`)
    if (existsSync(source)) {
      copyFileSync(source, target)
    } else {
      writeFileSync(target, monogramSvg(entry))
      placeholders += 1
    }
  }
  return placeholders
}

function signKey(): string | null {
  const fromEnv = process.env.CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY?.trim()
  if (fromEnv) return fromEnv
  const keyFile = join(SCRIPT_DIR, '.marketplace-catalog-signing-key.b64')
  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile, 'utf8').trim()
    if (key) return key
  }
  return null
}

function main(): void {
  const { entries, dir } = readEntries()
  if (entries.length === 0) {
    console.error(`rovers-catalog: no manifests found under ${dir} — aborting`)
    process.exit(1)
  }

  const source = { repo: SOURCE_REPO, commit: resolveCommit() }
  const generatedAt = resolveGeneratedAt({ source }, entries)
  const catalog = {
    version: 1 as const,
    generated_at: generatedAt,
    source,
    entries,
  }
  const body = `${JSON.stringify(catalog, null, 2)}\n`

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, 'catalog.json'), body, 'utf8')
  const digest = createHash('sha256').update(body, 'utf8').digest('hex')
  writeFileSync(join(OUT_DIR, 'catalog.json.sha256'), `${digest}  catalog.json\n`, 'utf8')

  const key = signKey()
  if (key) {
    writeFileSync(join(OUT_DIR, 'catalog.json.sig'), `${signCatalogBody(body, key)}\n`, 'utf8')
  } else {
    warn('no catalog signing key (CRAFT_MARKETPLACE_CATALOG_SIGNING_KEY or scripts/.marketplace-catalog-signing-key.b64) — wrote catalog.json + .sha256 only; sign before shipping')
  }

  const placeholders = stageIcons(entries)
  console.log(
    `rovers-catalog: ${entries.length} entries from ${dir} → ${join('apps', 'electron', 'resources', 'rovers')} ` +
      `(${entries.length - placeholders} icons copied, ${placeholders} monogram placeholders, ` +
      `sha256 ${digest.slice(0, 12)}…, sig ${key ? 'written' : 'absent'})`,
  )
}

main()