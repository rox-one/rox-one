import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { REDACTED_PLACEHOLDER, clearRegisteredSecretValues, redactRegisteredSecrets } from '@rox/shared/secrets'
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
  it('registers the embedded value so a child that echoes it is masked', () => {
    clearRegisteredSecretValues()
    try {
      const env: Record<string, string | undefined> = {}
      expect(installRoxDefaults({ roxApiKey: 'sk-embedded-gateway-key' }, env)).toBe('embedded')
      // A fixture child prints the inherited value; the redactor masks it.
      const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.env.ROX_API_KEY))'], {
        env: { ...env } as NodeJS.ProcessEnv,
        encoding: 'utf8',
      })
      expect(child.stdout).toBe('sk-embedded-gateway-key')
      expect(redactRegisteredSecrets(child.stdout)).toBe(REDACTED_PLACEHOLDER)
    } finally {
      clearRegisteredSecretValues()
    }
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
  it('writes from env, then from an env file, and never lets a stale key survive', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rox-defaults-'))
    const out = join(dir, 'gen.ts')
    expect(writeRoxDefaultsModule({}, out)).toBe('empty')
    expect(readFileSync(out, 'utf8')).toContain('"roxApiKey":""')
    expect(writeRoxDefaultsModule({ ROX_API_KEY: 'from-env' }, out)).toBe('set')
    expect(readFileSync(out, 'utf8')).toContain('from-env')
    expect(statSync(out).mode & 0o777).toBe(0o600)
    // An empty rebuild rewrites the module: the previous key must not linger.
    expect(writeRoxDefaultsModule({}, out)).toBe('empty')
    expect(readFileSync(out, 'utf8')).toContain('"roxApiKey":""')
    expect(readFileSync(out, 'utf8')).not.toContain('from-env')
    const envFile = join(dir, 'k.env')
    writeFileSync(envFile, 'ROX_API_KEY=from-file\n')
    expect(writeRoxDefaultsModule({ ROX_DEFAULTS_ENV_FILE: envFile }, out)).toBe('set')
    expect(readFileSync(out, 'utf8')).toContain('from-file')
    expect(existsSync(out)).toBe(true)
  })
})
