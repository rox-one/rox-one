/**
 * PERF-07 (#1566): the Low-power mode toggle persists across restarts.
 * `CONFIG_DIR` is captured at import, so each scenario runs in a subprocess
 * with its own tmpdir (same pattern as preferences-ui-language.test.ts).
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const PREFS_MODULE = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href

function run(configDir: string, body: string) {
  const script = `const p = await import(${JSON.stringify(PREFS_MODULE)});\n${body}`
  const result = Bun.spawnSync([process.execPath, '--eval', script], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir, ROX_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout.toString().trim(), stderr: result.stderr.toString() }
}

describe('preferences.renderProfilePreference', () => {
  it('defaults to auto and treats unknown values as auto', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-render-profile-'))
    try {
      expect(run(dir, 'console.log(p.getRenderProfilePreference())').stdout).toBe('auto')
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ renderProfilePreference: 'turbo' }))
      expect(run(dir, 'console.log(p.getRenderProfilePreference())').stdout).toBe('auto')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persists an explicit choice for the next process and keeps other fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-render-profile-'))
    try {
      writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ zenShellMaterialPreference: 'glass' }))
      const set = run(dir, "console.log(p.setRenderProfilePreference('standard'))")
      expect(set.exitCode).toBe(0)
      expect(set.stdout).toBe('standard')
      expect(run(dir, 'console.log(p.getRenderProfilePreference())').stdout).toBe('standard')
      const saved = JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8'))
      expect(saved.renderProfilePreference).toBe('standard')
      expect(saved.zenShellMaterialPreference).toBe('glass')
      expect(run(dir, "p.setRenderProfilePreference('performance'); console.log(p.getRenderProfilePreference())").stdout).toBe('performance')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects values outside auto/performance/standard', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prefs-render-profile-'))
    try {
      const result = run(dir, "try { p.setRenderProfilePreference('turbo'); console.log('saved') } catch { console.log('rejected') }")
      expect(result.stdout).toBe('rejected')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
