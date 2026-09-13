import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, 'FileViewer.tsx'), 'utf8')

describe('FileViewer error fallback is i18n', () => {
  it('uses t() instead of hardcoded English', () => {
    expect(source).toContain("t('fileViewer.failedToLoad')")
    expect(source).toContain("t(\"fileViewer.errorLoading\")")
    expect(source).not.toContain("'Failed to load file'")
  })
})
