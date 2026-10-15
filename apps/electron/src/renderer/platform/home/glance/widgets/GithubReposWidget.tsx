/** GitHub repositories: stars, open issues, last push (public REST API). */
import * as React from 'react'
import type { GlanceWidgetProps } from '../registry'
import { MultiFeed } from './net/MultiFeed'
import { repoList } from './GithubReleasesWidget'
import { parseGithubRepo } from './net/parsers'

export default function GithubReposWidget({ config }: GlanceWidgetProps) {
  const urls = React.useMemo(() => repoList(config.repos).map((r) => `https://api.github.com/repos/${r}`), [config.repos])
  return <MultiFeed urls={urls} as="json" parse={parseGithubRepo} refreshMs={60 * 60_000} limit={10} sort={false} />
}
