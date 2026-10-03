import type { UpdateInfo } from '@rox/shared/protocol'
import { compareSemver } from './auto-update-policy'

export type ReleaseMetadataFetcher = (url: string, options?: RequestInit) => Promise<Response>

const RELEASES_API = 'https://api.github.com/repos/rox-one/rox-one/releases?per_page=100'

/** Public release metadata only. Never downloads or installs executable assets. */
export async function checkPublishedManualUpdate(
  currentVersion: string,
  fetcher: ReleaseMetadataFetcher = fetch,
): Promise<UpdateInfo> {
  const response = await fetcher(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`GitHub release check failed (HTTP ${response.status}). Retry later or open the ROX releases page.`)
  const releases: unknown = await response.json()
  if (!Array.isArray(releases)) throw new Error('GitHub returned invalid release metadata')
  const candidates = releases.filter((release): release is {
    tag_name: string; published_at: string; assets: Array<{ name: string }>
  } => {
    if (!release || typeof release !== 'object' || release.draft === true) return false
    if (typeof release.tag_name !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.tag_name)) return false
    if (typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) return false
    const version = release.tag_name.replace(/^v/, '')
    return Array.isArray(release.assets) && release.assets.some((asset: unknown) =>
      !!asset && typeof asset === 'object' && 'name' in asset &&
      ['Rox-arm64.zip', 'Rox-arm64.dmg', `Rox-${version}-arm64.zip`, `Rox-${version}-arm64.dmg`].includes(String(asset.name)))
  }).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  const release = candidates[0]
  if (!release) throw new Error('No published macOS ARM64 ROX release is available')
  const latestVersion = release.tag_name.replace(/^v/, '')
  return {
    currentVersion,
    latestVersion,
    available: compareSemver(currentVersion, latestVersion) < 0,
    downloadState: 'idle',
    downloadProgress: 0,
    updateMode: 'manual',
    releaseUrl: `https://github.com/rox-one/rox-one/releases/tag/${encodeURIComponent(release.tag_name)}`,
  }
}
