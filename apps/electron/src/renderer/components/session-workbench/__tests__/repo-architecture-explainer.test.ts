import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SOURCE = readFileSync(join(__dirname, '..', 'RepoArchitectureExplainer.tsx'), 'utf8')

describe('RepoArchitectureExplainer', () => {
  it('renders i18n labels and source-line citations', () => {
    expect(SOURCE).toContain("t('codeIntel.title')")
    expect(SOURCE).toContain("t('codeIntel.empty')")
    expect(SOURCE).toContain("t('codeIntel.citation')")
    expect(SOURCE).toContain('node.citation')
  })
})
