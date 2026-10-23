/**
 * Built-in Glance widget registrations (metadata only — bodies load lazily).
 */
import { HOME_WIDGET_IDS } from '../dashboard-layout'
import { registerGlanceWidget } from './registry'

let registered = false

export function registerBuiltinGlanceWidgets(): void {
  if (registered) return
  registered = true

  registerGlanceWidget({
    type: 'rox',
    category: 'rox',
    titleKey: 'glance.w.rox',
    icon: 'layout-grid',
    defaultConfig: { widget: 'tasks', size: 'M' },
    fields: [
      {
        key: 'widget',
        kind: 'select',
        labelKey: 'glance.w.rox',
        options: HOME_WIDGET_IDS.filter((id) => id !== 'hero').map((id) => ({ value: id, labelKey: id === 'recentSessions' ? 'workbench.home.recent' : `workbench.home.w.${id}` })),
      },
      {
        key: 'size',
        kind: 'select',
        labelKey: 'glance.f.height',
        options: [
          { value: 'S', labelKey: 'workbench.home.edit.sizeS' },
          { value: 'M', labelKey: 'workbench.home.edit.sizeM' },
          { value: 'L', labelKey: 'workbench.home.edit.sizeL' },
        ],
      },
    ],
    frameless: true,
    load: () => import('./widgets/RoxWidget'),
  })

  registerGlanceWidget({
    type: 'clock',
    category: 'essentials',
    titleKey: 'glance.w.clock',
    icon: 'clock',
    defaultConfig: { hourFormat: '24h', showSeconds: false, timezones: [] },
    fields: [
      {
        key: 'hourFormat',
        kind: 'select',
        labelKey: 'glance.f.hourFormat',
        options: [
          { value: '24h', labelKey: 'glance.o.h24' },
          { value: '12h', labelKey: 'glance.o.h12' },
        ],
      },
      { key: 'showSeconds', kind: 'boolean', labelKey: 'glance.f.showSeconds' },
      { key: 'timezones', kind: 'strings', labelKey: 'glance.f.timezones', hintKey: 'glance.h.timezones', placeholder: 'Europe/Moscow' },
    ],
    load: () => import('./widgets/ClockWidget'),
  })

  registerGlanceWidget({
    type: 'todo',
    category: 'essentials',
    titleKey: 'glance.w.todo',
    icon: 'list-checks',
    defaultConfig: { items: [] },
    fields: [],
    load: () => import('./widgets/TodoWidget'),
  })

  registerGlanceWidget({
    type: 'bookmarks',
    category: 'essentials',
    titleKey: 'onboarding.environment.browserImportBookmarks',
    icon: 'bookmark',
    defaultConfig: { links: [], style: 'list' },
    fields: [
      { key: 'links', kind: 'links', labelKey: 'glance.f.links' },
      {
        key: 'style',
        kind: 'select',
        labelKey: 'glance.f.style',
        options: [
          { value: 'list', labelKey: 'collection.view.list' },
          { value: 'grid', labelKey: 'glance.o.grid' },
        ],
      },
    ],
    load: () => import('./widgets/BookmarksWidget'),
  })

  registerGlanceWidget({
    type: 'iframe',
    category: 'advanced',
    titleKey: 'glance.w.iframe',
    icon: 'app-window',
    defaultConfig: { url: '', height: 300 },
    fields: [
      { key: 'url', kind: 'url', labelKey: 'common.url', placeholder: 'https://' },
      { key: 'height', kind: 'number', labelKey: 'glance.f.heightPx', min: 80, max: 1600 },
    ],
    load: () => import('./widgets/IframeWidget'),
  })

  registerGlanceWidget({
    type: 'html',
    category: 'advanced',
    titleKey: 'clipboard.filter.text',
    icon: 'file-text',
    defaultConfig: { text: '' },
    fields: [{ key: 'text', kind: 'textarea', labelKey: 'clipboard.filter.text' }],
    load: () => import('./widgets/TextWidget'),
  })

  const limitField = { key: 'limit', kind: 'number', labelKey: 'glance.f.limit', min: 1, max: 50 } as const
  const collapseField = { key: 'collapseAfter', kind: 'number', labelKey: 'glance.f.collapseAfter', min: 0, max: 50 } as const

  registerGlanceWidget({
    type: 'rss',
    category: 'news',
    title: 'RSS',
    icon: 'rss',
    defaultConfig: { feeds: [], limit: 20, collapseAfter: 5 },
    fields: [
      { key: 'feeds', kind: 'strings', labelKey: 'screens.feed.groups.feeds', placeholder: 'https://example.com/feed.xml' },
      { ...limitField, max: 100 },
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/RssWidget'),
  })

  registerGlanceWidget({
    type: 'hacker-news',
    category: 'news',
    title: 'Hacker News',
    icon: 'newspaper',
    defaultConfig: { feed: 'top', limit: 15, collapseAfter: 5 },
    fields: [
      {
        key: 'feed',
        kind: 'select',
        labelKey: 'learning.screen.sort',
        options: [
          { value: 'top', labelKey: 'glance.o.top' },
          { value: 'new', labelKey: 'sidebar.view.new' },
          { value: 'show', labelKey: 'glance.o.showHn' },
          { value: 'ask', labelKey: 'glance.o.askHn' },
        ],
      },
      limitField,
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/HackerNewsWidget'),
  })

  registerGlanceWidget({
    type: 'lobsters',
    category: 'news',
    title: 'Lobsters',
    icon: 'newspaper',
    defaultConfig: { sort: 'hot', tag: '', limit: 15, collapseAfter: 5 },
    fields: [
      {
        key: 'sort',
        kind: 'select',
        labelKey: 'learning.screen.sort',
        options: [
          { value: 'hot', labelKey: 'glance.o.hot' },
          { value: 'new', labelKey: 'sidebar.view.new' },
        ],
      },
      { key: 'tag', kind: 'text', labelKey: 'glance.f.tag', placeholder: 'rust' },
      limitField,
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/LobstersWidget'),
  })

  registerGlanceWidget({
    type: 'reddit',
    category: 'news',
    title: 'Reddit',
    icon: 'message-square',
    defaultConfig: { subreddit: '', sort: 'hot', limit: 15, collapseAfter: 5 },
    fields: [
      { key: 'subreddit', kind: 'text', labelKey: 'glance.f.subreddit', placeholder: 'r/selfhosted' },
      {
        key: 'sort',
        kind: 'select',
        labelKey: 'learning.screen.sort',
        options: [
          { value: 'hot', labelKey: 'glance.o.hot' },
          { value: 'new', labelKey: 'sidebar.view.new' },
          { value: 'top', labelKey: 'glance.o.top' },
        ],
      },
      limitField,
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/RedditWidget'),
  })

  registerGlanceWidget({
    type: 'youtube',
    category: 'media',
    title: 'YouTube',
    icon: 'play',
    defaultConfig: { channels: [], limit: 15, collapseAfter: 5 },
    fields: [
      { key: 'channels', kind: 'strings', labelKey: 'glance.f.channels', hintKey: 'glance.f.youtubeHint', placeholder: 'UC…' },
      limitField,
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/YoutubeWidget'),
  })

  registerGlanceWidget({
    type: 'twitch',
    category: 'media',
    title: 'Twitch',
    icon: 'radio',
    defaultConfig: { channels: [] },
    fields: [{ key: 'channels', kind: 'strings', labelKey: 'glance.f.channels', placeholder: 'twitchdev' }],
    network: true,
    load: () => import('./widgets/TwitchWidget'),
  })

  registerGlanceWidget({
    type: 'github-releases',
    category: 'dev',
    title: 'GitHub Releases',
    icon: 'tag',
    defaultConfig: { repos: [], prereleases: false, limit: 10, collapseAfter: 5 },
    fields: [
      { key: 'repos', kind: 'strings', labelKey: 'glance.f.repos', placeholder: 'owner/repo' },
      { key: 'prereleases', kind: 'boolean', labelKey: 'glance.f.prereleases' },
      limitField,
      collapseField,
    ],
    network: true,
    load: () => import('./widgets/GithubReleasesWidget'),
  })

  registerGlanceWidget({
    type: 'github-repos',
    category: 'dev',
    title: 'GitHub',
    icon: 'git-branch',
    defaultConfig: { repos: [] },
    fields: [{ key: 'repos', kind: 'strings', labelKey: 'glance.f.repos', placeholder: 'owner/repo' }],
    network: true,
    load: () => import('./widgets/GithubReposWidget'),
  })
}
