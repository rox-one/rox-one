import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const localesDir = join(import.meta.dir, '../locales')
const enSource = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ruSource = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const HINT_KEYS = [
  'extensions.runtime.agent-runtime.hint',
  'extensions.runtime.automation-pack.hint',
  'extensions.runtime.craft-native.hint',
  'extensions.runtime.craft-sandbox.hint',
  'extensions.runtime.mcp-source.hint',
  'extensions.runtime.siyuan-plugin.hint',
  'extensions.runtime.skill-pack.hint',
  'extensions.runtime.web-widget.hint',
] as const

const EN_HINTS = {
  'extensions.runtime.agent-runtime.hint': 'External agent process supervisor',
  'extensions.runtime.automation-pack.hint': 'Automation engine (server-core)',
  'extensions.runtime.craft-native.hint': 'First-party Craft code (main/renderer)',
  'extensions.runtime.craft-sandbox.hint': 'Extension Host utilityProcess (sandboxed)',
  'extensions.runtime.mcp-source.hint': 'server-core SourceServerBuilder',
  'extensions.runtime.siyuan-plugin.hint': 'Inside SiYuan runtime (not Craft main)',
  'extensions.runtime.skill-pack.hint': 'SKILL.md documents read by the agent',
  'extensions.runtime.web-widget.hint': 'Sandboxed webContents only',
} as const

const RU_HINTS = {
  'extensions.runtime.agent-runtime.hint': 'Супервизор внешнего процесса агента',
  'extensions.runtime.automation-pack.hint': 'Движок автоматизации (server-core)',
  'extensions.runtime.craft-native.hint': 'Собственный код Craft (main/renderer)',
  'extensions.runtime.craft-sandbox.hint': 'Extension Host utilityProcess (в песочнице)',
  'extensions.runtime.mcp-source.hint': 'SourceServerBuilder в server-core',
  'extensions.runtime.siyuan-plugin.hint': 'Внутри runtime SiYuan (не Craft main)',
  'extensions.runtime.skill-pack.hint': 'Документы SKILL.md, которые читает агент',
  'extensions.runtime.web-widget.hint': 'Только webContents в песочнице',
} as const

describe('P35-81 extensions.runtime.*.hint Russian values', () => {
  it('keeps English source English', () => {
    for (const key of HINT_KEYS) {
      expect(enSource[key], key).toBe(EN_HINTS[key])
    }
  })

  it('stores distinct Russian hint copy in ru.json', () => {
    for (const key of HINT_KEYS) {
      expect(ruSource[key], key).toBe(RU_HINTS[key])
      expect(ruSource[key], key).not.toBe(enSource[key])
    }
  })

  it('resolves Russian strings after changeLanguage(ru)', async () => {
    await setupI18n().changeLanguage('ru')
    for (const key of HINT_KEYS) {
      expect(i18n.t(key), key).toBe(RU_HINTS[key])
      expect(i18n.t(key), key).not.toBe(EN_HINTS[key])
    }
  })

  it('still resolves English strings after changeLanguage(en)', async () => {
    await setupI18n().changeLanguage('en')
    for (const key of HINT_KEYS) {
      expect(i18n.t(key), key).toBe(EN_HINTS[key])
    }
  })
})
