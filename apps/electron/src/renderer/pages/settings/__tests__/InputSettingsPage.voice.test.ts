import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

describe('InputSettingsPage voice section', () => {
  it('renders the shared voice settings through i18n', () => {
    const source = readFileSync(
      join(import.meta.dir, '../InputSettingsPage.tsx'),
      'utf8',
    )
    expect(source).toContain('VoiceSettingsSection')
    const section = readFileSync(join(import.meta.dir, '../VoiceSettingsSection.tsx'), 'utf8')
    expect(section).toContain('settings.input.voiceGroupGeneral')
    expect(section).toContain('settings.input.voiceGroupHistory')
    expect(section).toContain('settings.input.voiceGroupModels')
    expect(section).toContain('settings.input.voiceGroupProcessing')
    expect(section).toContain('voiceAsrConsent')
    expect(section).toContain('voiceEnhancementConsent')
    expect(section).toContain('voiceWebEnrichment')

  })

  it('offers Edge as an explicit saved choice and keeps its disclosure visible after selection', async () => {
    const source = readFileSync(join(import.meta.dir, '../VoiceSettingsSection.tsx'), 'utf8')
    const file = ts.createSourceFile('VoiceSettingsSection.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let row: ts.JsxSelfClosingElement | undefined
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'SettingsMenuSelectRow'
        && node.attributes.getText(file).includes("label={t('settings.input.ttsEngine')}")) row = node
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(row).toBeDefined()
    function expression(name: string) {
      const attr = row!.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(file) === name) as ts.JsxAttribute
      const expr = (attr.initializer as ts.JsxExpression).expression!
      return ts.transpile(`(${expr.getText(file)})`, { target: ts.ScriptTarget.ESNext })
    }
    const saved: unknown[] = []
    const run = (name: string, engine: 'system' | 'edge') => new Function('t', 'prefs', 'save', `return ${expression(name)}`)(
      (key: string) => key, { ttsEngine: engine }, async (patch: unknown) => { saved.push(patch) },
    )
    expect(run('options', 'system')).toEqual([
      { value: 'system', label: 'settings.input.ttsSystem', description: 'settings.input.ttsSystemDesc' },
      { value: 'edge', label: 'settings.input.ttsEdge', description: 'settings.input.ttsEdgeDesc' },
    ])
    expect(run('value', 'system')).toBe('system')
    expect(run('description', 'system')).toBe('settings.input.ttsSystemDesc')
    expect(run('description', 'edge')).toBe('settings.input.ttsEdgeDesc')
    expect(saved).toEqual([])
    run('onValueChange', 'system')('edge')
    await Promise.resolve()
    expect(saved).toEqual([{ ttsEngine: 'edge' }])
    run('onValueChange', 'edge')('system')
    await Promise.resolve()
    expect(saved.at(-1)).toEqual({ ttsEngine: 'system' })
  })
})
