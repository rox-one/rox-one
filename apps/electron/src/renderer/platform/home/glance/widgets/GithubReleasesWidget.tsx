/** GitHub releases for several repos, newest first (public REST API). */
import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { MultiFeed } from './net/MultiFeed'
import { clampInt } from './net/kit'
import { cleanRepo, parseGithubReleases } from './net/parsers'

export function repoList(value: unknown, max = 10): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanRepo).filter((r): r is string => !!r))].slice(0, max)
}

const repoOf = (url: string) => url.replace('https://api.github.com/repos/', '').replace(/\/releases.*$/, '')

export default function GithubReleasesWidget({ config }: GlanceWidgetProps) {
  const urls = React.useMemo(() => repoList(config.repos).map((r) => `https://api.github.com/repos/${r}/releases?per_page=5`), [config.repos])
  const pre = config.prereleases === true
  const parse = React.useCallback((raw: unknown, url: string) => parseGithubReleases(raw, repoOf(url), pre), [pre])
  return <MultiFeed urls={urls} as="json" parse={parse} refreshMs={60 * 60_000} limit={clampInt(config.limit, 1, 50, 10)} collapseAfter={clampInt(config.collapseAfter, 0, 50, 5)} />
}
