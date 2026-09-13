import type {
  ComponentEntry,
  PlaygroundAppearanceConstraint,
  PlaygroundLevel,
} from './types'

/**
 * Explicit contract for a file-discovered playground story.
 *
 * A `*.playground.tsx` module may default-export one story, an array of
 * stories, or expose a `stories` array. The latter makes grouped stories easy
 * without reintroducing a central registry import.
 */
export interface PlaygroundStoryModule {
  default?: ComponentEntry | ComponentEntry[]
  stories?: ComponentEntry[]
}

/** Marks a default export as a file-discovered Playground story. */
export function definePlaygroundStory(story: ComponentEntry): ComponentEntry {
  return story
}

type StoryCandidate = ComponentEntry | ComponentEntry[] | PlaygroundStoryModule | undefined | null

const LEGACY_LEVEL: PlaygroundLevel = 'Patterns'

export interface ResolvedPlaygroundAppearance {
  /** `null` clears a story override while the literal `default` forces it. */
  theme: string | null
  /** `null` leaves the user's current mode untouched. */
  mode: NonNullable<PlaygroundAppearanceConstraint['mode']> | null
}

/**
 * Resolves optional story appearance into values the preview can apply.
 *
 * In particular, keeping `default` as a string distinguishes an explicit
 * default-theme story from a story that does not constrain its theme at all.
 */
export function resolvePlaygroundAppearance(
  appearance: PlaygroundAppearanceConstraint | undefined,
): ResolvedPlaygroundAppearance {
  return {
    theme: appearance?.theme ?? null,
    mode: appearance?.mode ?? null,
  }
}

function isComponentEntry(candidate: unknown): candidate is ComponentEntry {
  return typeof candidate === 'object'
    && candidate !== null
    && typeof (candidate as Partial<ComponentEntry>).id === 'string'
    && typeof (candidate as Partial<ComponentEntry>).name === 'string'
    && typeof (candidate as Partial<ComponentEntry>).category === 'string'
    && typeof (candidate as Partial<ComponentEntry>).component === 'function'
}

function normalizeEntry(entry: ComponentEntry): ComponentEntry {
  return {
    ...entry,
    level: entry.level ?? LEGACY_LEVEL,
  }
}

/** Normalizes both existing registry entries and file-discovered story modules. */
export function normalizePlaygroundStories(candidates: readonly StoryCandidate[]): ComponentEntry[] {
  const normalized: ComponentEntry[] = []
  const seenIds = new Set<string>()

  for (const candidate of candidates) {
    const entries = Array.isArray(candidate)
      ? candidate
      : isComponentEntry(candidate)
        ? [candidate]
        : candidate && typeof candidate === 'object'
          ? [candidate.default, candidate.stories].flat()
          : []

    for (const entry of entries) {
      if (!isComponentEntry(entry)) continue

      if (seenIds.has(entry.id)) {
        throw new Error(`Duplicate Playground story id: ${entry.id}`)
      }

      seenIds.add(entry.id)
      normalized.push(normalizeEntry(entry))
    }
  }

  return normalized
}

/**
 * Vite returns an object keyed by path. Sorting preserves a deterministic
 * sidebar order across file systems and development/release builds.
 */
export function normalizeDiscoveredPlaygroundStories(modules: Record<string, unknown>): ComponentEntry[] {
  return normalizePlaygroundStories(
    Object.entries(modules)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, module]) => module as StoryCandidate)
  )
}
