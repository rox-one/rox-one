import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installRoxDefaults } from '../install-rox-defaults'
import { parseDotenv, renderRoxDefaultsModule, writeRoxDefaultsModule } from '../../../../scripts/gen-rox-defaults'

describe('installRoxDefaults', () => {
  it('fills ROX_API_KEY from the embedded default when unset', () => {
    const env: Record<string, string | undefined> = {}
    expect(installRoxDefaults({ roxApiKey: ' shared-key ' }, env)).toBe('embedded')
    expect(env.ROX_API_KEY).toBe('shared-key')
  })
  it('keeps a key the user already provides', () => {
    const env: Record<string, string | undefined> = { ROX_API_KEY: 'mine' }
    expect(installRoxDefaults({ roxApiKey: 'shared-key' }, env)).toBe('env')
    expect(env.ROX_API_KEY).toBe('mine')
  })
  it('treats a blank env value as unset', () => {
    const env: Record<string, string | undefined> = { ROX_API_KEY: '  ' }
    expect(installRoxDefaults({ roxApiKey: 'shared-key' }, env)).toBe('embedded')
    expect(env.ROX_API_KEY).toBe('shared-key')
  })
  it('does nothing when the build embedded no key', () => {
    const env: Record<string, string | undefined> = {}
    expect(installRoxDefaults({ roxApiKey: '' }, env)).toBe('none')
    expect(installRoxDefaults(undefined, env)).toBe('none')
    expect('ROX_API_KEY' in env).toBe(false)
  })
})

describe('gen-rox-defaults', () => {
  it('parses dotenv lines, quotes and export prefixes', () => {
    expect(parseDotenv('# c\nexport ROX_API_KEY="abc"\nOTHER=x=y\n')).toEqual({ ROX_API_KEY: 'abc', OTHER: 'x=y' })
  })
  it('renders a module whose value round-trips as JSON', () => {
    const src = renderRoxDefaultsModule('k"ey')
    expect(src).toContain('gitignored')
    expect(src).toContain(JSON.stringify({ roxApiKey: 'k"ey' }))
  })
  it('writes from env, then from an env file, and never clobbers with empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-defaults-'))
    const out = join(dir, 'gen.ts')
    expect(writeRoxDefaultsModule({}, out)).toBe('empty')
    expect(readFileSync(out, 'utf8')).toContain('"roxApiKey":""')
    expect(writeRoxDefaultsModule({ ROX_API_KEY: 'from-env' }, out)).toBe('set')
    expect(readFileSync(out, 'utf8')).toContain('from-env')
    expect(statSync(out).mode & 0o777).toBe(0o600)
    expect(writeRoxDefaultsModule({}, out)).toBe('kept')
    expect(readFileSync(out, 'utf8')).toContain('from-env')
    const envFile = join(dir, 'k.env')
    writeFileSync(envFile, 'ROX_API_KEY=from-file\n')
    expect(writeRoxDefaultsModule({ ROX_DEFAULTS_ENV_FILE: envFile }, out)).toBe('set')
    expect(readFileSync(out, 'utf8')).toContain('from-file')
    expect(existsSync(out)).toBe(true)
  })
})
