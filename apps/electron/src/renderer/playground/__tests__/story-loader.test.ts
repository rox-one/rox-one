import { describe, expect, it } from 'bun:test'
import { PLAYGROUND_LEVELS, type ComponentEntry } from '../registry/types'
import {
  definePlaygroundStory,
  normalizeDiscoveredPlaygroundStories,
  normalizePlaygroundStories,
  resolvePlaygroundAppearance,
} from '../registry/story-loader'

const Preview = () => null

function entry(id: string, level?: ComponentEntry['level']): ComponentEntry {
  return {
    id,
    name: id,
    category: 'Sources',
    level,
    description: id,
    component: Preview,
    props: [],
  }
}

describe('playground story loader', () => {
  it('keeps existing registry entries and assigns their legacy level', () => {
    expect(normalizePlaygroundStories([entry('legacy')])).toMatchObject([
      { id: 'legacy', level: 'Patterns' },
    ])
  })

  it('preserves the explicit file-story contract', () => {
    expect(definePlaygroundStory(entry('contract', 'Screens'))).toMatchObject({
      id: 'contract',
      level: 'Screens',
    })
  })

  it('accepts both default and grouped file-story module contracts', () => {
    expect(normalizePlaygroundStories([
      { default: entry('screen', 'Screens') },
      { stories: [entry('flow', 'Flows')] },
    ])).toMatchObject([
      { id: 'screen', level: 'Screens' },
      { id: 'flow', level: 'Flows' },
    ])
  })

  it('preserves every declared top-level level for future file stories', () => {
    const stories = normalizePlaygroundStories(
      PLAYGROUND_LEVELS.map((level, index) => entry(`story-${index}`, level))
    )

    expect(stories.map(story => story.level)).toEqual([...PLAYGROUND_LEVELS])
  })

  it('uses sorted file paths so discovered sidebar ordering is deterministic', () => {
    const stories = normalizeDiscoveredPlaygroundStories({
      '../stories/z.playground.tsx': { default: entry('z') },
      '../stories/a.playground.tsx': { default: entry('a') },
    })

    expect(stories.map(story => story.id)).toEqual(['a', 'z'])
  })

  it('fails fast when a discovered story duplicates a legacy id', () => {
    expect(() => normalizePlaygroundStories([
      entry('shared-id'),
      { default: entry('shared-id', 'Screens') },
    ])).toThrow('Duplicate Playground story id: shared-id')
  })

  it('distinguishes an explicit default appearance from no story constraint', () => {
    expect(resolvePlaygroundAppearance(undefined)).toEqual({ theme: null, mode: null })
    expect(resolvePlaygroundAppearance({ theme: 'default', mode: 'light' })).toEqual({
      theme: 'default',
      mode: 'light',
    })
  })
})
