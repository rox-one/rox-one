import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('ROX2-191 Cloud Runs are native, not Conation', () => {
  test('settings page stays a native config surface and does not submit spend', () => {
    const page = source('apps/electron/src/renderer/pages/settings/CloudRunsSettingsPage.tsx')
    expect(page).toContain("pageId: 'cloudRuns'")
    expect(page).toContain("action: 'config-read'")
    expect(page).toContain("action: 'pref-write'")
    expect(page).toContain('settingsPageActionResult')
    expect(page).not.toContain("action: 'spend'")
    expect(page).not.toContain('conation.dev')
    expect(page).not.toMatch(/<iframe\b/i)
    expect(page).not.toContain('CompleteMutationRoot')
  })

  test('SUBMIT uses native spend with grant; config/schedule remain write', () => {
    const rpc = source('packages/server-core/src/handlers/rpc/cloud-runs.ts')
    expect(rpc).toContain("action: 'spend'")
    expect(rpc).toContain("granted: true")
    expect(rpc).toContain("nativeId: 'submit'")
    expect(rpc).toContain("nativeId: 'config'")
    expect(rpc).toContain("nativeId: 'schedule'")
    expect(rpc).toContain("action: 'write'")
    expect(rpc).not.toContain('conation.dev')
    expect(rpc).not.toContain('CompleteMutationRoot')
    expect(rpc).not.toContain('GraphqlSoupEmailThread')
  })

  test('native spend helper only claims live for cloud-runs with an explicit grant', () => {
    const helper = source('packages/core/src/rox2/rpc-native-actions.ts')
    expect(helper).toContain("opts.surface === 'cloud-runs' && opts.granted === true")
    expect(helper).toContain('cloud-runs spend requires an explicit grant')
  })
})
