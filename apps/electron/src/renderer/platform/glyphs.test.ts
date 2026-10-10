/**
 * W2.6 — glyph dictionary contracts. Guarantees the «сущность → значок» map is
 * complete (every concept has a name and an icon), that a name round-trips to
 * its component, and that the same concept renders the SAME glyph in
 * navigation, the mode/pill seed and the extra-screen registry (the drift
 * D6/§4.4 documents: `Home`/`House`, `MessageSquare`/`MessageCircle`,
 * `Brain`/`Sparkles`, `NotebookPen`/`FilePlus2`).
 */
import { describe, expect, it } from 'bun:test'
import type { LucideIcon } from 'lucide-react'
import { GLYPHS, GLYPH_ICONS_BY_NAME, GLYPH_NAMES, type GlyphConcept } from './glyphs'
import { resolveLucideIcon } from './lucide-icon'
import { CORE_MODES, UNIFIED_MODES } from './modes-seed'
import { DEFAULT_PILL_SURFACES } from './pill-composition'
import { APP_NAV_DESTINATIONS } from '../components/app-shell/nav-destinations'
import { EXTRA_SCREENS } from '../pages/extra-screens/registry'

const CONCEPTS = Object.keys(GLYPHS) as GlyphConcept[]

/** Consumer id → the entity concept it stands for. */
const NAV_CONCEPT: Record<string, GlyphConcept> = {
  sessions: 'sessions',
  notes: 'notes',
  memory: 'memory',
  memoryRepo: 'memoryRepo',
  browser: 'browser',
  automations: 'automations',
  projects: 'projects',
  pages: 'pages',
  tasks: 'tasks',
  learning: 'learning',
  meetings: 'calendar',
  sources: 'sources',
  skills: 'skills',
  connections: 'connections',
  home: 'home',
  knowledge: 'knowledge',
  settings: 'settings',
  clipboardHistory: 'clipboardHistory',
  drive: 'drive',
  developers: 'developers',
  playbooks: 'playbooks',
}

const CORE_CONCEPT: Record<string, GlyphConcept> = {
  home: 'home',
  chat: 'sessions',
  tasks: 'tasks',
  notes: 'notes',
  feed: 'feed',
  inbox: 'inbox',
}

const UNIFIED_CONCEPT: Record<string, GlyphConcept> = {
  messenger: 'team',
  calendar: 'calendar',
  goals: 'goals',
}

const PILL_CONCEPT: Record<string, GlyphConcept> = {
  feed: 'feed',
  team: 'team',
  agent: 'home',
  notes: 'notes',
  browser: 'browser',
}

/** Concepts that must agree across at least two consumers (spec §4.4 canon). */
const KEY_CONCEPTS: readonly GlyphConcept[] = ['home', 'notes', 'tasks', 'feed', 'inbox', 'team']
/** Subset that genuinely spans more than one consumer surface. */
const MULTI_CONSUMER_CONCEPTS: readonly GlyphConcept[] = ['home', 'notes', 'tasks', 'feed', 'team']

interface Observation {
  source: string
  concept: GlyphConcept
  glyph: LucideIcon
}

function observations(): Observation[] {
  const out: Observation[] = []
  for (const dest of APP_NAV_DESTINATIONS) {
    const concept = NAV_CONCEPT[dest.id]
    if (!concept) throw new Error(`nav destination without a concept mapping: ${dest.id}`)
    out.push({ source: `nav:${dest.id}`, concept, glyph: dest.icon })
  }
  for (const mode of CORE_MODES) {
    const concept = CORE_CONCEPT[mode.contribution.id]
    if (!concept) throw new Error(`core mode without a concept mapping: ${mode.contribution.id}`)
    out.push({
      source: `mode:${mode.contribution.id}`,
      concept,
      glyph: resolveLucideIcon(mode.contribution.icon) ?? (undefined as unknown as LucideIcon),
    })
  }
  for (const mode of UNIFIED_MODES) {
    const concept = UNIFIED_CONCEPT[mode.contribution.id]
    if (!concept) throw new Error(`unified mode without a concept mapping: ${mode.contribution.id}`)
    out.push({
      source: `mode:${mode.contribution.id}`,
      concept,
      glyph: resolveLucideIcon(mode.contribution.icon) ?? (undefined as unknown as LucideIcon),
    })
  }
  for (const surface of DEFAULT_PILL_SURFACES) {
    const concept = PILL_CONCEPT[surface.id]
    if (!concept) throw new Error(`pill surface without a concept mapping: ${surface.id}`)
    out.push({ source: `pill:${surface.id}`, concept, glyph: resolveLucideIcon(surface.icon) ?? (undefined as unknown as LucideIcon) })
  }
  for (const screen of EXTRA_SCREENS) {
    out.push({ source: `extra:${screen.id}`, concept: screen.id as GlyphConcept, glyph: screen.icon })
  }
  return out
}

describe('glyph dictionary completeness', () => {
  it('defines a name for every concept and nothing more', () => {
    expect([...Object.keys(GLYPH_NAMES)].sort()).toEqual([...CONCEPTS].sort())
  })

  it('maps every concept to a distinct PascalCase Lucide name that resolves back to its component', () => {
    const names = new Set<string>()
    for (const concept of CONCEPTS) {
      const name = GLYPH_NAMES[concept]
      expect(name).toMatch(/^[A-Z]/)
      expect(resolveLucideIcon(name)).toBe(GLYPHS[concept])
      expect(GLYPH_ICONS_BY_NAME[name]).toBe(GLYPHS[concept])
      expect(names.has(name)).toBe(false)
      names.add(name)
    }
  })
})

describe('one glyph per entity concept', () => {
  it('every consumer renders the concept glyph from the dictionary', () => {
    for (const { source, concept, glyph } of observations()) {
      expect(glyph, `${source} should use GLYPHS.${concept}`).toBe(GLYPHS[concept])
    }
  })

  it('key concepts agree across navigation, seed, pill and registry', () => {
    const byConcept = new Map<GlyphConcept, Set<LucideIcon>>()
    const sources = new Map<GlyphConcept, Set<string>>()
    for (const { source, concept, glyph } of observations()) {
      if (!byConcept.has(concept)) {
        byConcept.set(concept, new Set())
        sources.set(concept, new Set())
      }
      byConcept.get(concept)!.add(glyph)
      sources.get(concept)!.add(source)
    }
    for (const concept of KEY_CONCEPTS) {
      const glyphs = byConcept.get(concept)
      expect(glyphs, `no consumer renders the «${concept}» concept`).toBeDefined()
      expect(glyphs!.size, `«${concept}» must render one glyph only`).toBe(1)
    }
    for (const concept of MULTI_CONSUMER_CONCEPTS) {
      expect(
        sources.get(concept)!.size,
        `«${concept}» must appear in ≥2 consumers`,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('documents the resolved divergences (no Home/MessageCircle/Sparkles carriers)', () => {
    // W2.6 canonical choices: House (not the deprecated Home alias), one
    // sessions glyph (MessageSquare), Brain for memory (Zap for skills).
    expect(GLYPH_NAMES.home).toBe('House')
    expect(GLYPH_NAMES.sessions).toBe('MessageSquare')
    expect(GLYPH_NAMES.memory).toBe('Brain')
    // Nav and the mode seed now agree on the merged calendar glyph.
    expect(APP_NAV_DESTINATIONS.find((d) => d.id === 'meetings')?.icon).toBe(GLYPHS.calendar)
  })
})