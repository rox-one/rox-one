import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Harness precedent: `pages/dev-space/__tests__/dev-space-pages.test.ts` reads the
// page sources and asserts literal i18n keys, the RPC surface it walks, and the
// state/a11y coverage — no renderer mount required. С-15 lives across the route
// file plus the codebook/ page and its components.
const root = join(__dirname, '..')
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8')
const codebookDir = join(root, 'codebook')
const componentsDir = join(codebookDir, 'components')

const home = read('PlaybooksHomePage.tsx')
const store = read('notebook-store.ts')
const homeView = read('components', 'NotebookHome.tsx')
const page = read('codebook', 'CodebookNotebookPage.tsx')
const client = read('codebook', 'codebook-client.ts')
const components = readdirSync(componentsDir)
  .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
  .map((name) => read('codebook', 'components', name))
  .join('\n')

describe('Codebook entry + gate (С-15, С-12)', () => {
  it('is a default-export page gated on playbooks.v1 + playbooks.codebook.v1', () => {
    expect(page).toContain('export default function CodebookNotebookPage')
    expect(home).toContain('playbooksEnabledAtom')
    expect(home).toContain('workbenchFlagAtom(WORKBENCH_FLAG.playbooksCodebookV1)')
    expect(home).toContain("from './codebook/CodebookNotebookPage'")
  })

  it('routes codebook notebooks to the editor and shows the disabled notice when gated off', () => {
    expect(home).toContain("activeNotebook.mode === 'codebook'")
    expect(home).toContain('<CodebookNotebookPage')
    expect(home).toContain('data-testid="playbooks-codebook-disabled"')
    expect(home).toContain("t('playbooks.codebook.disabled')")
  })

  it('enables the Home create-codebook action only when the codebook flag is on', () => {
    expect(homeView).toContain('codebookEnabled')
    expect(homeView).toContain('data-testid="playbooks-home-mode-codebook"')
    expect(homeView).toContain("t('playbooks.home.codebookSoon')")
    expect(homeView).toContain("t('playbooks.codebook.cellsCount'")
  })
})

describe('Codebook cells (С-15)', () => {
  it('walks the frozen playbooks codebook bridge', () => {
    expect(client).toContain('window.electronAPI.runCodebook')
    expect(client).toContain('window.electronAPI.cancelCodebook')
    expect(client).toContain('window.electronAPI.listCodebookRuns')
    expect(client).toContain('window.electronAPI.onCodebookJob')
    expect(client).toContain("from '@rox/shared/playbooks'")
  })

  it('supports script/agent/artifact cells with add, remove and reorder', () => {
    expect(page).toContain("const ALL_KINDS: readonly CodebookCellKind[] = ['script', 'agent', 'artifact']")
    expect(page).toContain('createCodebookCell')
    expect(page).toContain('playbooks-codebook-add-')
    expect(components).toContain('playbooks-codebook-remove-')
    expect(components).toContain('playbooks-codebook-up-')
    expect(components).toContain('playbooks-codebook-down-')
    expect(components).toContain("t('playbooks.codebook.runCell')")
    expect(store).toContain('export function createCodebookCell')
    expect(store).toContain('function parseCell(')
  })

  it('runs all / a single cell, follows the push stream and cancels', () => {
    expect(page).toContain('runCodebook({')
    expect(page).toContain('onCodebookJob(')
    expect(page).toContain('cancelCodebook({')
    expect(page).toContain('data-testid="playbooks-codebook-run-all"')
    expect(page).toContain('data-testid="playbooks-codebook-stop"')
    expect(components).toContain('onRun')
  })

  it('folds the job stream by monotonic seq (late events never rewind)', () => {
    expect(page).toContain('current.seq >= next.seq ? current : next')
  })

  it('renders per-step status, bounded output, errors and artifact/session refs', () => {
    expect(components).toContain('playbooks-codebook-step-state-')
    expect(components).toContain('playbooks-codebook-step-error-')
    expect(components).toContain("t('playbooks.codebook.output.artifact'")
    expect(components).toContain("t('playbooks.codebook.output.session'")
    expect(page).toContain('data-testid="playbooks-codebook-context"')
    expect(page).toContain('data-testid="playbooks-codebook-artifacts"')
  })

  it('surfaces queued/running/done/failed/cancelled + empty/offline states', () => {
    expect(page).toContain('playbooks-codebook-progress')
    expect(page).toContain('role="progressbar"')
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain('data-testid="playbooks-codebook-empty"')
    expect(page).toContain('data-testid="playbooks-codebook-offline"')
    expect(page).toContain('playbooks.codebook.jobState.${job.state}')
  })

  it('respects reduced-motion for animated progress/spinners', () => {
    expect(page).toContain('motion-reduce:transition-none')
    expect(page).toContain('motion-reduce:animate-none')
    expect(components).toContain('motion-reduce:animate-none')
  })

  it('uses literal playbooks.codebook.* keys and aria labels — no hardcoded copy', () => {
    for (const key of [
      'playbooks.codebook.back', 'playbooks.codebook.runAll', 'playbooks.codebook.stop',
      'playbooks.codebook.emptyTitle', 'playbooks.codebook.templateAction', 'playbooks.codebook.contextTitle',
    ]) expect(page).toContain(`t('${key}'`)
    expect(components).toContain("t(`playbooks.codebook.kind.${kind}`)")
    expect(components).toContain("aria-label={t('playbooks.codebook.moveUp')}")
    expect(components).toContain("aria-label={t('playbooks.codebook.removeCell')}")
  })
})

describe('Codebook reuse + export (С-15)', () => {
  it('reuses the В4 notebook store and the С-14 saveTextFile export precedent', () => {
    expect(page).toContain("from '../notebook-store'")
    expect(client).toContain('window.electronAPI.saveTextFile')
    expect(client).toContain("filters: input.format === 'json'")
    expect(page).toContain("exportNotebook('md')")
    expect(page).toContain('data-testid="playbooks-codebook-export-json"')
    expect(page).toContain('data-testid="playbooks-codebook-export-md"')
  })

  it('references В2 artifacts through the optional dev-space reader', () => {
    expect(client).toContain('readDevSpaceArtifact')
    expect(client).toContain('export async function readCellArtifact')
    expect(components).toContain('readCellArtifact')
  })
})

describe('Codebook persistence', () => {
  it('persists ordered cells defensively in the notebook record', () => {
    expect(store).toContain('readonly cells?: readonly CodebookCell[]')
    expect(store).toContain('Array.isArray(record.cells)')
    expect(store).toContain("mode === 'codebook' ? { cells: [] }")
  })
})