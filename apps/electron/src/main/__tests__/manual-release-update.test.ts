import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { checkPublishedManualUpdate, type ReleaseMetadataFetcher } from '../manual-release-update'
import { shouldOfferManualReleaseCheck } from '../auto-update-policy'

const release = (version: string, date = '2026-10-03T00:00:00Z') => ({
  tag_name: `v${version}`, published_at: date, draft: false,
  assets: [{ name: 'Rox-arm64.zip' }, { name: 'Rox-arm64.dmg' }],
})
const fake = (data: unknown) => (async () => new Response(JSON.stringify(data))) as ReleaseMetadataFetcher

test('only unsigned release installations in /Applications permit explicit metadata checks', () => {
  const base = { homeDir: '/Users/test', execPath: '/Applications/Rox.app/Contents/MacOS/Rox', isAdHocSigned: true }
  expect(shouldOfferManualReleaseCheck(base)).toBe(true)
  expect(shouldOfferManualReleaseCheck({ ...base, isAdHocSigned: false })).toBe(false)
  expect(shouldOfferManualReleaseCheck({ ...base, craftDevRuntime: '1' })).toBe(false)
  expect(shouldOfferManualReleaseCheck({ ...base, execPath: '/Users/test/Applications/Rox.app/Contents/MacOS/Rox' })).toBe(false)
  expect(shouldOfferManualReleaseCheck({ ...base, execPath: '/Applications-unsafe/Rox.app' })).toBe(false)
})

test('manual check accepts newest published preview with compatible assets, no download/ready state', async () => {
  const requests: string[] = []
  const fetcher = (async (url: string | URL | Request, options?: RequestInit) => {
    requests.push(String(url))
    expect(options?.headers).toEqual({ Accept: 'application/vnd.github+json' })
    return new Response(JSON.stringify([
      release('0.11.7', '2026-10-01T00:00:00Z'),
      { ...release('0.11.8'), prerelease: true, html_url: 'https://malicious.invalid/' },
      { ...release('99.0.0'), draft: true },
      { ...release('99.0.1'), assets: [{ name: 'Rox-99.0.1-x64.exe' }] },
    ]))
  }) as ReleaseMetadataFetcher
  const info = await checkPublishedManualUpdate('0.11.7', fetcher)
  expect(requests).toEqual(['https://api.github.com/repos/rox-one/rox-one/releases?per_page=100'])
  expect(info.available).toBe(true)
  expect(info.latestVersion).toBe('0.11.8')
  expect(info.updateMode).toBe('manual')
  expect(info.downloadState).toBe('idle')
  expect(info.releaseUrl).toBe('https://github.com/rox-one/rox-one/releases/tag/v0.11.8')
})

test('manual check also recognizes legacy versioned artifact names', async () => {
  const info = await checkPublishedManualUpdate('0.11.7', fake([{ ...release('0.11.8'), assets: [{ name: 'Rox-0.11.8-arm64.zip' }] }]))
  expect(info.available).toBe(true)
})

test('manual metadata cannot suggest downgrade or nonexistent platform release', async () => {
  expect((await checkPublishedManualUpdate('0.11.9', fake([release('0.11.8')]))).available).toBe(false)
  await expect(checkPublishedManualUpdate('0.11.8', fake([]))).rejects.toThrow('No published')
  await expect(checkPublishedManualUpdate('0.11.8', fake({}))).rejects.toThrow('invalid release metadata')
  await expect(checkPublishedManualUpdate('0.11.8', (async () => new Response('', { status: 403 })) as ReleaseMetadataFetcher)).rejects.toThrow('HTTP 403')
})

test('manual check and install boundaries are explicit in production entry points', () => {
  const mainDir = join(import.meta.dir, '..')
  const updater = readFileSync(join(mainDir, 'auto-update.ts'), 'utf8')
  expect(updater).toContain('autoUpdater.autoInstallOnAppQuit = !isUpdateFeedSuppressed()')
  expect(updater).toContain('if (options.manual && canCheckMetadata)')
  expect(updater).toContain("if (isUpdateFeedSuppressed() || updateInfo.updateMode === 'manual')")
  const handlers = readFileSync(join(mainDir, 'handlers/system.ts'), 'utf8')
  expect(handlers).toContain('checkForUpdates({ autoDownload: true, manual: true })')
  const hook = readFileSync(join(mainDir, '../renderer/hooks/useUpdateChecker.ts'), 'utf8')
  expect(hook.indexOf('if (info.error)')).toBeLessThan(hook.lastIndexOf('if (!info.available)'))
})

test('chooses highest compatible version rather than a republished older release', async () => {
  const info = await checkPublishedManualUpdate('0.11.7', fake([
    release('0.11.8', '2026-10-02T00:00:00Z'), release('0.11.7', '2026-10-03T00:00:00Z'),
    { ...release('99.0.0'), assets: [{ name: 'Rox-x64.exe' }] },
  ]))
  expect(info.latestVersion).toBe('0.11.8')
  expect(info.available).toBe(true)
})

test('promotes prerelease to stable, orders prerelease numbers and rejects downgrades/malformed versions', async () => {
  const data = [release('0.11.8-beta.10'), release('0.11.8'), release('0.11.8-beta.9'), release('0.11.8-beta.01'), release('0.011.8')]
  const stable = await checkPublishedManualUpdate('0.11.8-beta.1', fake(data))
  expect(stable.available).toBe(true)
  expect(stable.latestVersion).toBe('0.11.8')
  const noDowngrade = await checkPublishedManualUpdate('0.11.8', fake([release('0.11.8-beta.10')]))
  expect(noDowngrade.available).toBe(false)
  const beta = await checkPublishedManualUpdate('0.11.8-beta.9', fake(data.filter(r => r.tag_name !== 'v0.11.8')))
  expect(beta.latestVersion).toBe('0.11.8-beta.10')
  expect(beta.available).toBe(true)
})

test('native menu checks explicitly use manual metadata route and renderer notifies broadcast results', () => {
  const mainDir = join(import.meta.dir, '..')
  const menu = readFileSync(join(mainDir, 'menu.ts'), 'utf8')
  const calls = [...menu.matchAll(/checkForUpdates\((\{[^}]*\})\)/g)]
  expect(calls.length).toBe(2)
  for (const call of calls) expect(call[1]).toContain('manual: true')
  const hook = readFileSync(join(mainDir, '../renderer/hooks/useUpdateChecker.ts'), 'utf8')
  const broadcast = hook.slice(hook.indexOf('const checkAndNotify'), hook.indexOf('// Check for updates manually'))
  expect(broadcast).toContain("if (info.updateMode === 'manual')")
  expect(broadcast).toContain('showManualUpdateToast(info)')
  expect(broadcast).toContain('checkAndNotify(info)')
})

test('actual manual notification callback offers a release link once and reports errors/current versions', () => {
  const source = readFileSync(join(import.meta.dir, '../../renderer/hooks/useUpdateChecker.ts'), 'utf8')
  const start = source.indexOf('  const shownManualNoticeRef =')
  const end = source.indexOf('  // Install the update', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const calls: Array<{ kind: string; options: { action?: { onClick: () => void }; description?: string } }> = []
  const opened: string[] = []
  const callback = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end)
    + '; globalThis.probe = { showManualUpdateToast, shownManualNoticeRef };')
  const context: any = {
    MANUAL_UPDATE_TOAST_ID: 'manual-update-check',
    useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
    t: (key: string) => key,
    toast: Object.fromEntries(['info', 'success', 'error'].map(kind => [kind,
      (_message: string, options: any) => calls.push({ kind, options })])),
    window: { electronAPI: { openUrl: (url: string) => { opened.push(url) } } },
  }
  runInNewContext(callback, context)
  const probe = context.probe
  const info = { updateMode: 'manual', available: true, currentVersion: '0.11.7', latestVersion: '0.11.8',
    releaseUrl: 'https://github.com/rox-one/rox-one/releases/tag/v0.11.8' }
  // Native menu broadcast followed by Settings RPC readback must show one toast.
  probe.showManualUpdateToast(info); probe.showManualUpdateToast(info)
  expect(calls.map(c => c.kind)).toEqual(['info'])
  expect((calls[0]!.options as any).id).toBe('manual-update-check')
  expect(opened).toEqual([])
  calls[0]!.options.action!.onClick()
  expect(opened).toEqual([info.releaseUrl])
  probe.shownManualNoticeRef.current = null
  probe.showManualUpdateToast(info)
  expect(calls.length).toBe(2)
  probe.shownManualNoticeRef.current.at -= 2000 // A later native-menu click may notify again.
  probe.showManualUpdateToast(info)
  expect(calls.length).toBe(3)
  probe.showManualUpdateToast({ ...info, available: false, error: 'HTTP 403', releaseUrl: undefined })
  probe.showManualUpdateToast({ ...info, available: false, error: 'HTTP 403', releaseUrl: undefined })
  expect(calls.at(-1)?.kind).toBe('error')
  expect(calls.at(-1)?.options.description).toBe('HTTP 403')
  expect(calls.length).toBe(4)
  probe.showManualUpdateToast({ ...info, available: false, releaseUrl: undefined })
  expect(calls.at(-1)?.kind).toBe('success')
  probe.showManualUpdateToast({ ...info, updateMode: 'automatic' })
  expect(calls.length).toBe(5)
})
