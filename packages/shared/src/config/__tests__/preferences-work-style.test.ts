/**
 * formatPreferencesForPrompt appends the onboarding work style from
 * environment.json. Runs in a subprocess: the config dir is read at load.
 */
import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const PREFS_MODULE = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href

function run(configDir: string): { exitCode: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(
    [process.execPath, '--eval', `import { formatPreferencesForPrompt } from '${PREFS_MODULE}'; console.log(JSON.stringify(formatPreferencesForPrompt()))`],
    { env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe' },
  )
  return { exitCode: r.exitCode ?? -1, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
}

describe('formatPreferencesForPrompt + work style', () => {
  it('includes the onboarding answers so the agent follows them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-work-style-'))
    try {
      writeFileSync(join(dir, 'environment.json'), JSON.stringify({
        version: 1,
        seenVersion: 1,
        role: { status: 'answered', value: { isDeveloper: false, isDeveloperExplicit: true, relatedRoles: [], workStyle: { clarify: 'askFirst', formats: ['xlsx'] } } },
      }))
      const r = run(dir)
      expect(r.exitCode).toBe(0)
      const text = JSON.parse(r.stdout) as string
      expect(text).toContain('## User Preferences')
      expect(text).toContain('### How this user wants you to work')
      expect(text).toContain('ask the clarifying questions')
      expect(text).toContain('XLSX spreadsheets')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('adds nothing when the role was never answered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-work-style-'))
    try {
      const r = run(dir)
      expect(r.exitCode).toBe(0)
      expect(JSON.parse(r.stdout) as string).not.toContain('How this user wants you to work')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
