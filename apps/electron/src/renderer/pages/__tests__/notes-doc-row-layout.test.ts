import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression: in ~470px tiles the document row shrank to its content, so the
// editor's scroll track showed as a dark stripe in the middle of the panel.
const source = readFileSync(join(import.meta.dir, '../NotesPage.tsx'), 'utf8')
const classesOf = (marker: string) => {
  const tag = source.slice(source.lastIndexOf('<div', source.indexOf(marker)), source.indexOf('>', source.indexOf(marker)))
  return /className="([^"]+)"/.exec(tag)?.[1].split(/\s+/) ?? []
}

describe('notes document row layout', () => {
  test.each(['data-testid="notes-retained-editor"', 'data-testid="notes-doc-row"'])('%s fills its panel', marker => {
    expect(classesOf(marker)).toEqual(expect.arrayContaining(['flex', 'w-full', 'min-w-0', 'flex-1']))
  })
})
