import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  expect(hook.indexOf('if (info.error)')).toBeLessThan(hook.indexOf('else if (!info.available)'))
})
