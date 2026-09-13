import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const popover = readFileSync(join(import.meta.dir, '../label-value-popover.tsx'), 'utf8')
const secret = readFileSync(join(import.meta.dir, '../../settings/SettingsInput.tsx'), 'utf8')
const mindmap = readFileSync(join(import.meta.dir, '../../../mindmap/engine/svg-engine.tsx'), 'utf8')

describe('finish-visual leftover chrome contracts', () => {
  it('translates label value placeholders and localizes dates', () => {
    expect(popover).toContain("t('labels.numberPlaceholder')")
    expect(popover).toContain("t('labels.urlPlaceholder')")
    expect(popover).toContain("t('labels.valuePlaceholder')")
    expect(popover).toContain('getDateLocale')
    expect(popover).not.toContain('Enter number...')
    expect(popover).not.toContain('Enter URL...')
    expect(popover).not.toContain('Enter value...')
  })

  it('translates the SettingsSecretInput default placeholder', () => {
    expect(secret).toContain("t('common.enterValue')")
    expect(secret).not.toContain("placeholder = 'Enter value...'")
  })

  it('uses PremiumMenuSelect for mindmap parent picking', () => {
    expect(mindmap).toContain('PremiumMenuSelect')
    expect(mindmap).not.toMatch(/<select[\s\S]*structureEditor.parentId/)
  })
})
