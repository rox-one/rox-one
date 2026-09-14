import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const localesDir = join(import.meta.dir, '../locales')
const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8')) as Record<string, string>
const ru = JSON.parse(readFileSync(join(localesDir, 'ru.json'), 'utf8')) as Record<string, string>

const keys = [
  'connections.connect',
  'connections.import.adcPath',
  'connections.import.awsConfigPath',
  'connections.import.awsCredentialsPath',
  'connections.import.discoverAdc',
  'connections.import.discoverAws',
  'connections.import.discoverDocker',
  'connections.import.discoverGitHelper',
  'connections.import.discoverKeychain',
  'connections.import.discoverSshAgent',
  'connections.import.dockerConfigPath',
  'connections.import.envPath',
  'connections.import.gitConfigPath',
  'connections.imports.commit',
  'connections.imports.discover',
  'connections.repair',
  'connections.revoke',
  'connections.revokeCancel',
  'connections.revokeConfirm',
  'connections.rotate',
  'connections.rotateCancel',
  'connections.rotateConfirm',
  'connections.test',
] as const

describe('P35-72 ConnectionsPage leftover chrome locales', () => {
  it('keeps Russian copy distinct from English', () => {
    for (const key of keys) {
      expect(en[key], key).toBeTruthy()
      expect(ru[key], key).toBeTruthy()
      expect(ru[key], key).not.toBe(en[key])
    }
    expect(en['connections.connect']).toBe('Connect')
    expect(ru['connections.connect']).toBe('Подключить')
    expect(en['connections.test']).toBe('Test')
    expect(ru['connections.test']).toBe('Проверить')
    expect(en['connections.import.envPath']).toBe('.env path')
    expect(ru['connections.import.envPath']).toBe('Путь к .env')
  })

  it('defines the inserted keys in all 12 locales', () => {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json')).sort()
    expect(files).toHaveLength(12)
    for (const file of files) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), 'utf8')) as Record<string, string>
      for (const key of keys) {
        expect(locale[key]?.length, `${file} ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
