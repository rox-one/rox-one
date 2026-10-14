import { describe, expect, it } from 'bun:test'
import { cleanRepo, cleanTwitchLogin, cleanYoutubeChannel, parseGithubReleases, parseGithubRepo } from '../home/glance/widgets/net/parsers'
import { youtubeUrls } from '../home/glance/widgets/YoutubeWidget'
import { repoList } from '../home/glance/widgets/GithubReleasesWidget'
import { parseTwitchUptime, twitchUptimeUrl } from '../home/glance/widgets/TwitchWidget'
import { feedUrls } from '../home/glance/widgets/RssWidget'

const UC = 'UCabcdefghijklmnopqrstuv'

describe('glance network widgets batch 2', () => {
  it('validates ids', () => {
    expect(cleanYoutubeChannel(UC)).toBe(UC)
    expect(cleanYoutubeChannel(`https://www.youtube.com/channel/${UC}/videos`)).toBe(UC)
    expect(cleanYoutubeChannel('@handle')).toBeNull()
    expect(youtubeUrls([UC, UC, 'x'])).toEqual([`https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`])
    expect(cleanRepo('https://github.com/oven-sh/bun/')).toBe('oven-sh/bun')
    expect(cleanRepo('a/../b')).toBeNull()
    expect(cleanRepo('a/b/c')).toBeNull()
    expect(repoList(['a/b', 'a/b', 7])).toEqual(['a/b'])
    expect(cleanTwitchLogin('https://www.twitch.tv/TwitchDev')).toBe('twitchdev')
    expect(cleanTwitchLogin('a b')).toBeNull()
    expect(feedUrls(['https://x.test/f', 'ftp://x', 'https://x.test/f'])).toEqual(['https://x.test/f'])
  })

  it('parses GitHub releases and repos', () => {
    const rel = parseGithubReleases([
      { tag_name: 'v2', name: 'Two', html_url: 'https://github.com/a/b/releases/tag/v2', published_at: '2026-10-01T00:00:00Z' },
      { tag_name: 'v3-rc', html_url: 'https://github.com/a/b/releases/tag/v3-rc', prerelease: true },
      { tag_name: 'v4', html_url: 'https://github.com/a/b/releases/tag/v4', draft: true },
      { tag_name: 'evil', html_url: 'https://evil.test/' },
    ], 'a/b')
    expect(rel.map((r) => r.title)).toEqual(['a/b v2'])
    expect(rel[0]!.meta).toBe('Two')
    expect(parseGithubReleases([{ tag_name: 'v3-rc', html_url: 'https://github.com/a/b/releases/tag/v3-rc', prerelease: true }], 'a/b', true)).toHaveLength(1)
    expect(parseGithubRepo({ full_name: 'a/b', html_url: 'https://github.com/a/b', stargazers_count: 10, open_issues_count: 2 })[0]).toMatchObject({ title: 'a/b', score: 10, comments: 2 })
    expect(parseGithubRepo({ message: 'API rate limit exceeded' })).toEqual([])
  })

  it('reads Twitch uptime text', () => {
    const url = twitchUptimeUrl('twitchdev')
    expect(parseTwitchUptime('twitchdev is offline', url)[0]!.score).toBeUndefined()
    expect(parseTwitchUptime('2 hours, 3 minutes', url)[0]).toMatchObject({ title: 'twitchdev', score: 1, meta: '2 hours, 3 minutes' })
    expect(parseTwitchUptime(42, url)).toEqual([])
  })
})
