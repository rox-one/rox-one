import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { i18n, setupI18n } from '../setupI18n'

const BOOTSTRAP = 'ssh.bootstrap.description' as const
const DESCRIPTION = 'ssh.description' as const

const EN_BOOTSTRAP = 'Setting up a Rox server on the remote host. This may take a minute the first time.'
const EN_DESCRIPTION = 'Tunnel to a Rox server running on a remote host over SSH.'
const RU_BOOTSTRAP = 'Настройка сервера Rox на удалённом хосте. В первый раз это может занять около минуты.'
const RU_DESCRIPTION = 'Туннель к серверу Rox на удалённом хосте через SSH.'

const en = JSON.parse(readFileSync(join(import.meta.dir, '../locales/en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(import.meta.dir, '../locales/ru.json'), 'utf8')) as Record<string, string>

describe('leftover English Server wrapping in ru ssh copy', () => {
  it('keeps English catalog copy unchanged', () => {
    expect(en[BOOTSTRAP]).toBe(EN_BOOTSTRAP)
    expect(en[DESCRIPTION]).toBe(EN_DESCRIPTION)
    expect(en[BOOTSTRAP]).toContain('Rox server')
    expect(en[DESCRIPTION]).toContain('Rox server')
  })

  it('wraps leftover Server as Russian common noun around Latin Rox', () => {
    expect(ru[BOOTSTRAP]).toBe(RU_BOOTSTRAP)
    expect(ru[DESCRIPTION]).toBe(RU_DESCRIPTION)
    expect(ru[BOOTSTRAP]).toContain('сервера Rox')
    expect(ru[DESCRIPTION]).toContain('серверу Rox')
    expect(ru[BOOTSTRAP]).not.toMatch(/\bServer\b/)
    expect(ru[DESCRIPTION]).not.toMatch(/\bServer\b/)
    expect(ru[BOOTSTRAP]).not.toBe(en[BOOTSTRAP])
    expect(ru[DESCRIPTION]).not.toBe(en[DESCRIPTION])
  })

  it("resolves Russian through setupI18n without leftover English Server", async () => {
    await setupI18n().changeLanguage('ru')
    expect(i18n.t(BOOTSTRAP)).toBe(RU_BOOTSTRAP)
    expect(i18n.t(DESCRIPTION)).toBe(RU_DESCRIPTION)
    expect(i18n.t(BOOTSTRAP)).not.toBe(EN_BOOTSTRAP)
    expect(i18n.t(DESCRIPTION)).not.toBe(EN_DESCRIPTION)
    expect(i18n.t(BOOTSTRAP)).not.toMatch(/\bServer\b/)
    expect(i18n.t(DESCRIPTION)).not.toMatch(/\bServer\b/)
  })

  it('resolves English through setupI18n as the original leftover string', async () => {
    await setupI18n().changeLanguage('en')
    expect(i18n.t(BOOTSTRAP)).toBe(EN_BOOTSTRAP)
    expect(i18n.t(DESCRIPTION)).toBe(EN_DESCRIPTION)
    expect(i18n.t(BOOTSTRAP)).toContain('Rox server')
    expect(i18n.t(DESCRIPTION)).toContain('Rox server')
  })
})
