import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// В1 pages are split into the route files plus pages/dev-space/components/*.
const devSpaceDir = join(__dirname, '..')
const componentsDir = join(devSpaceDir, 'components')
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')
const home = read(devSpaceDir, 'DevSpaceHomePage.tsx')
const repo = read(devSpaceDir, 'DevSpaceRepoPage.tsx')
const playbooks = read(devSpaceDir, '..', 'playbooks', 'PlaybooksHomePage.tsx')
const roadmap = read(devSpaceDir, '..', 'ProjectRoadmapPage.tsx')
const parts = [home, repo, ...readdirSync(componentsDir).filter((name) => name.endsWith('.ts') || name.endsWith('.tsx')).map((name) => read(componentsDir, name))].join('\n')

describe('Dev Space home (С-01)', () => {
  it('is a self-contained default-export page using literal i18n keys', () => {
    expect(home).toContain('export default function DevSpaceHomePage')
    expect(home).toContain("t('devSpace.home.title')")
    expect(home).toContain("t('devSpace.home.connect')")
    expect(home).toContain("t('devSpace.home.emptyAction')")
    expect(home).toContain("t('devSpace.home.searchPlaceholder')")
    expect(home).not.toMatch(/<select\b/)
  })

  it('walks the frozen ingest bridge and cancels by requestId', () => {
    expect(home).toContain('window.electronAPI.listDevSpaceRepositories')
    expect(home).toContain('window.electronAPI.addDevSpaceRepository')
    expect(home).toContain('window.electronAPI.startDevSpaceClone')
    expect(home).toContain('window.electronAPI.refreshDevSpaceRepository')
    expect(home).toContain('window.electronAPI.removeDevSpaceRepository')
    expect(home).toContain('window.electronAPI.cancelDevSpaceRequest')
    expect(home).toContain('window.electronAPI.onDevSpaceCloneProgress')
    expect(home).toContain('window.electronAPI.onDevSpaceChanged')
  })

  it('emits the two В1 telemetry events through the local analytics module', () => {
    expect(home).toContain("emitDevSpaceEvent({ eventName: 'devspace.repo-added'")
    expect(home).toContain("emitDevSpaceEvent({ eventName: 'devspace.clone-finished'")
    expect(home).toContain("from '@/features/dev-space/analytics'")
  })

  it('covers empty/loading/error states and removal confirmation', () => {
    expect(home).toContain("t('devSpace.home.retry')")
    expect(home).toContain('data-testid="dev-space-loading"')
    expect(home).toContain('data-testid="dev-space-remove-confirm"')
    expect(home).toContain("t('devSpace.remove.title')")
  })
})

describe('Dev Space repo workspace (С-03)', () => {
  it('is a default-export page keyed by devSpaceRepoId', () => {
    expect(repo).toContain('export default function DevSpaceRepoPage')
    expect(repo).toContain('devSpaceRepoId?: string')
    expect(repo).toContain('data-testid="dev-space-repo-not-found"')
  })

  it('renders the six artifact surfaces from literal tab keys', () => {
    for (const surface of ['wiki', 'understanding', 'graph', 'schemas', 'knowledgeGraph', 'c4']) {
      expect(parts).toContain(`devSpace.repo.tabs.${surface}`)
    }
    expect(repo).toContain('<ArtifactSurface')
    expect(parts).toContain('data-testid={`dev-space-surface-${kind}`}')
    expect(parts).not.toContain("t('devSpace.repo.stub.title')")
  })

  it('walks the artifact read bridge and starts the analysis pipeline', () => {
    expect(repo).toContain('window.electronAPI.listDevSpaceArtifacts')
    expect(repo).toContain('window.electronAPI.startDevSpaceRun')
    expect(repo).toContain('window.electronAPI.onDevSpaceRunProgress')
    expect(repo).toContain('window.electronAPI.refreshDevSpaceRepository')
    expect(parts).toContain('window.electronAPI.readDevSpaceArtifact')
  })

  it('renders markdown artifacts through the shared Notes markdown pipeline', () => {
    expect(parts).toContain("from '@/components/markdown'")
    expect(parts).toContain('<Markdown mode="full">')
  })

  it('covers empty and stale surfaces with literal keys', () => {
    expect(parts).toContain("t('devSpace.artifact.emptyTitle')")
    expect(parts).toContain("t('devSpace.artifact.emptyAction')")
    expect(parts).toContain('data-testid="dev-space-artifact-stale"')
    expect(parts).toContain("t('devSpace.repository.outdated')")
  })

  it('shows the outdated badge from the lastSnapshotId rule', () => {
    expect(parts).toContain('lastSnapshotId !== record.lastAnalyzedSnapshotId')
    expect(parts).toContain('data-testid="dev-space-outdated"')
  })
})

describe('Playbooks home (С-12 stub) and roadmap deep link', () => {
  it('renders the flag-gated Playbooks stub', () => {
    expect(playbooks).toContain('export default function PlaybooksHomePage')
    expect(playbooks).toContain("t('playbooks.home.title')")
    expect(playbooks).toContain("t('playbooks.home.enabledNotice')")
  })

  it('adds the open-in-dev-space button without disturbing the snapshot panel', () => {
    expect(roadmap).toContain('routes.view.developers(project.config.id)')
    expect(roadmap).toContain("t('devSpace.openInDevSpace')")
    expect(roadmap).toContain('data-testid="project-dev-space-link"')
    expect(roadmap).toContain('<RepositorySnapshotPanel')
  })
})