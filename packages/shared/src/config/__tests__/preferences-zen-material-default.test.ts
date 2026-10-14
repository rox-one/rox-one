/**
 * Ghost layer: the window material defaults to opaque. Native vibrancy/Mica
 * behind translucent chrome showed other windows and stale frames through the
 * shell, so glass is opt-in and an implicitly persisted `system` migrates.
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
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout.toString().trim() }
}

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'prefs-zen-material-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('zen shell material default', () => {
  it('is opaque on a fresh install', () => withDir((dir) => {
    expect(run(dir, 'console.log(p.getZenShellMaterialPreference())').stdout).toBe('opaque')
  }))

  it('migrates an implicitly persisted value to opaque', () => withDir((dir) => {
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ zenShellMaterialPreference: 'system' }))
    expect(run(dir, 'console.log(p.getZenShellMaterialPreference())').stdout).toBe('opaque')
  }))

  it('keeps legacy glass/opaque picks (only Settings ever wrote them)', () => withDir((dir) => {
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify({ zenShellMaterialPreference: 'glass' }))
    expect(run(dir, 'console.log(p.getZenShellMaterialPreference())').stdout).toBe('glass')
  }))

  it('keeps an explicit choice and does not mark unrelated writes explicit', () => withDir((dir) => {
    expect(run(dir, "p.setZenShellPreference({ materialDepth: 'deep' }); console.log(p.getZenShellMaterialPreference())").stdout).toBe('opaque')
    expect(JSON.parse(readFileSync(join(dir, 'preferences.json'), 'utf8')).zenShellMaterialPreferenceExplicit).toBeUndefined()
    expect(run(dir, "p.setZenShellPreference({ materialPreference: 'glass' }); console.log(p.getZenShellMaterialPreference())").stdout).toBe('glass')
    expect(run(dir, "p.setZenShellPreference({ enabled: true }); console.log(p.getZenShellMaterialPreference())").stdout).toBe('glass')
  }))
})
