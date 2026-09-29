import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAP_TOOLBAR_BREAKPOINTS, mapToolbarDensity, mapToolbarLayout } from '../map-toolbar-density'

const editorSource = readFileSync(join(__dirname, '..', 'SessionWorkflowEditor.tsx'), 'utf8')

describe('map toolbar density', () => {
  test('steps down with width and treats unmeasured as full', () => {
    expect(mapToolbarDensity(undefined)).toBe('full')
    expect(mapToolbarDensity(0)).toBe('full')
    expect(mapToolbarDensity(Number.NaN)).toBe('full')
    expect(mapToolbarDensity(1200)).toBe('full')
    expect(mapToolbarDensity(MAP_TOOLBAR_BREAKPOINTS.compact)).toBe('full')
    expect(mapToolbarDensity(MAP_TOOLBAR_BREAKPOINTS.compact - 1)).toBe('compact')
    expect(mapToolbarDensity(MAP_TOOLBAR_BREAKPOINTS.tight - 1)).toBe('tight')
    expect(mapToolbarDensity(MAP_TOOLBAR_BREAKPOINTS.micro - 1)).toBe('micro')
    expect(mapToolbarDensity(160)).toBe('micro')
  })

  test('every density keeps a home for each control (inline or ⋯ menu)', () => {
    const full = mapToolbarLayout('full')
    expect(full).toEqual({
      inlineLayoutActions: true,
      inlineCamera: true,
      showKindChips: true,
      showLiveChip: true,
      showSceneCount: true,
    })
    expect(mapToolbarLayout('compact').inlineLayoutActions).toBe(false)
    expect(mapToolbarLayout('compact').inlineCamera).toBe(true)
    expect(mapToolbarLayout('tight').inlineCamera).toBe(false)
    expect(mapToolbarLayout('tight').showLiveChip).toBe(false)
    expect(mapToolbarLayout('micro').showSceneCount).toBe(false)
  })

  test('editor measures the toolbar and routes overflow into the ⋯ menu behind the empty-map guard', () => {
    expect(editorSource).toContain('new ResizeObserver(')
    expect(editorSource).toContain('mapToolbarLayout(mapToolbarDensity(')
    // Run + ⋯ are unconditional; overflow items live in the non-empty branch.
    expect(editorSource).toMatch(
      /\{mapEmpty \? \([\s\S]*?map-toolbar-empty-hint[\s\S]*?\) : \([\s\S]*?!toolbarLayout\.inlineCamera[\s\S]*?!toolbarLayout\.inlineLayoutActions[\s\S]*?applyCanvasLayout\('left'\)/,
    )
  })
})
