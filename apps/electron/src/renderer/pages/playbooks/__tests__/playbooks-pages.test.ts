import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Harness precedent: `pages/dev-space/__tests__/dev-space-pages.test.ts` reads the
// page sources and asserts literal i18n keys, the RPC surface it walks, and the
// state/a11y coverage — no renderer mount required. С-12/С-13/С-14 live across
// the route file plus components/knowledge/podcast subdirs.
const root = join(__dirname, '..')
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

const home = read('PlaybooksHomePage.tsx')
const store = read('notebook-store.ts')
const homeView = read('components/NotebookHome.tsx')
const knowledge = read('knowledge/KnowledgeNotebookPage.tsx')
const presets = read('knowledge/PresetQuestions.tsx')
const answers = read('knowledge/SourceAnswerList.tsx')
const sourceIndex = read('knowledge/useSourceIndex.ts')
const studio = read('podcast/PodcastStudio.tsx')
const podcastClient = read('podcast/podcast-client.ts')

describe('Playbooks home (С-12)', () => {
  it('is a self-contained default-export page gated on playbooks.v1 + playbooks.knowledge.v1', () => {
    expect(home).toContain('export default function PlaybooksHomePage')
    expect(home).toContain('playbooksEnabledAtom')
    expect(home).toContain('workbenchFlagAtom(WORKBENCH_FLAG.playbooksKnowledgeV1)')
    expect(home).toContain("t('playbooks.home.title')")
  })

  it('uses literal playbooks.* keys — no hardcoded copy', () => {
    expect(homeView).toContain("t('playbooks.home.newNotebook')")
    expect(homeView).toContain("t('playbooks.home.emptyAction')")
    expect(homeView).toContain("t('playbooks.home.searchPlaceholder')")
  })

  it('covers empty/loading/error/offline states and reversible removal', () => {
    expect(homeView).toContain('data-testid="playbooks-home-loading"')
    expect(homeView).toContain('data-testid="playbooks-home-offline"')
    expect(homeView).toContain("t('playbooks.home.retry')")
    expect(homeView).toContain('data-testid="playbooks-home-delete-confirm"')
    expect(homeView).toContain("t('playbooks.home.deleteTitle')")
  })

  it('persists the notebook list defensively', () => {
    expect(store).toContain("'rox.playbooks.notebooks.v1'")
    expect(store).toContain('export function parseNotebooks')
    expect(store).toContain('export function createNotebook')
  })
})

describe('Knowledge notebook (С-13)', () => {
  it('reuses the existing sources panel and the sources:* RPC surface', () => {
    expect(knowledge).toContain("from '@/components/app-shell/SourcesListPanel'")
    expect(knowledge).toContain('<SourcesListPanel')
    expect(sourceIndex).toContain('window.electronAPI.getSources')
    expect(sourceIndex).toContain('window.electronAPI.reindexSources')
    expect(sourceIndex).toContain('window.electronAPI.getSourceIndexStatus')
    expect(sourceIndex).toContain('window.electronAPI.searchSourcesIndex')
    expect(sourceIndex).toContain('window.electronAPI.onSourcesChanged')
    expect(sourceIndex).toContain('window.electronAPI.onSourceIndexChanged')
    expect(knowledge).toContain('window.electronAPI.deleteSource')
  })

  it('answers source questions and exposes preset questions', () => {
    expect(knowledge).toContain('searchSourceIndex')
    expect(knowledge).toContain('<SourceAnswerList')
    expect(presets).toContain('PRESET_QUESTION_IDS')
    expect(presets).toContain('playbooks.notebook.presets.${id}')
    expect(answers).toContain('data-testid="playbooks-notebook-citation"')
  })

  it('covers index loading/error/partial/empty states and aria-live progress', () => {
    expect(knowledge).toContain('data-testid="playbooks-notebook-sources-loading"')
    expect(knowledge).toContain("t('playbooks.notebook.indexError'")
    expect(knowledge).toContain('data-testid="playbooks-notebook-partial"')
    expect(knowledge).toContain('data-testid="playbooks-notebook-ask"')
    expect(knowledge).toContain('aria-live="polite"')
    expect(knowledge).toContain('motion-reduce:animate-none')
  })
})

describe('Podcast studio (С-14)', () => {
  it('starts a run and follows the podcast:job push stream', () => {
    expect(studio).toContain("from './podcast-client'")
    expect(studio).toContain('startPodcast({')
    expect(studio).toContain('onPodcastJob(')
    expect(podcastClient).toContain('window.electronAPI.startPodcast')
    expect(podcastClient).toContain('window.electronAPI.onPodcastJob')
    expect(podcastClient).toContain('window.electronAPI.cancelPodcast')
    expect(podcastClient).toContain('window.electronAPI.podcastEpisodes')
    expect(podcastClient).toContain('window.electronAPI.podcastEpisodeAudioUrl')
    expect(podcastClient).toContain("from '@rox/shared/voice'")
  })

  it('sends projectSlug only when the notebook is bound (server default otherwise)', () => {
    expect(podcastClient).toContain('projectSlug?: string')
    expect(podcastClient).toContain('params as PodcastStartInput')
    expect(home).toContain('projectSlug={activeNotebook.projectSlug}')
  })

  it('offers engine system|edge, optional segment count, and editable roles', () => {
    expect(studio).toContain('data-testid="playbooks-podcast-engine"')
    expect(studio).toContain('<SelectItem value="system">')
    expect(studio).toContain('<SelectItem value="edge">')
    expect(studio).toContain('data-testid="playbooks-podcast-segments"')
    expect(studio).toContain("t('playbooks.podcast.roleHost')")
    expect(studio).toContain("t('playbooks.podcast.roleExpert')")
  })

  it('shows stage/segment progress, an audio player and mp3/srt export', () => {
    expect(studio).toContain('data-testid="playbooks-podcast-progress"')
    expect(studio).toContain('data-testid="playbooks-podcast-segments-list"')
    expect(studio).toContain('role="progressbar"')
    expect(studio).toContain('data-testid="playbooks-podcast-player"')
    expect(studio).toContain('data-testid="playbooks-podcast-export-mp3"')
    expect(studio).toContain('data-testid="playbooks-podcast-export-srt"')
  })

  it('exports renderer-side through the shared precedent', () => {
    expect(podcastClient).toContain('window.electronAPI.saveTextFile')
    expect(podcastClient).toContain("filters: [{ name: 'SRT', extensions: ['srt'] }]")
    expect(podcastClient).toContain('readPodcastEpisodeAudio')
    expect(podcastClient).toContain('URL.createObjectURL')
    expect(studio).toContain('exportPodcastEpisode({')
  })

  it('respects reduced-motion for animated progress/rows', () => {
    expect(studio).toContain('motion-reduce:animate-none')
    expect(studio).toContain('motion-reduce:transition-none')
  })
})

describe('D12 name-collision rename', () => {
  it('reuses the existing SessionWorkbench label keys (updated in en/ru only)', () => {
    const en = readFileSync(join(root, '../../../../../../packages/shared/src/i18n/locales/en.json'), 'utf8')
    const ru = readFileSync(join(root, '../../../../../../packages/shared/src/i18n/locales/ru.json'), 'utf8')
    expect(en).toContain('"entityView.playbookHoles": "Task fan-outs"')
    expect(ru).toContain('"entityView.playbookHoles": "Веера задач"')
    expect(en).not.toContain('"entityView.playbookHoles": "Playbook holes"')
    expect(ru).not.toContain('"entityView.playbookHoles": "Дыры сценария"')
  })
})