/**
 * ImportReviewDialog — happy-dom mount against a mocked RPC surface, with the
 * @rox/ui + local dialog primitives reduced to plain elements.
 */
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// Keep every real export (e.g. `setI18n`, imported by entities/__tests__/test-env.tsx)
// in the mocked namespace, so registering this module process-wide cannot break a
// sibling test file that statically imports a named export.
import * as actualReactI18next from 'react-i18next'
import type { ImportReviewDialog as ImportReviewDialogComponent } from '../ImportReviewDialog'

useDomForFile()

mock.module('react-i18next', () => ({
  ...actualReactI18next,
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${Object.values(vars).join(' ')}` : key),
    i18n: { language: 'ru' },
  }),
}))
mock.module('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
mock.module('@rox/ui', () => ({
  UnifiedDiffViewer: ({ unifiedDiff }: { unifiedDiff: string }) => React.createElement('pre', { 'data-testid': 'diff-body' }, unifiedDiff),
}))
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogContent: ({ children, ...rest }: { children?: React.ReactNode }) => React.createElement('div', rest, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogDescription: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}))
mock.module('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode }) => React.createElement('button', { type: 'button', ...rest }, children),
}))

let ImportReviewDialog: typeof ImportReviewDialogComponent

beforeAll(async () => {
  ({ ImportReviewDialog } = await import('../ImportReviewDialog'))
})

afterEach(() => { resetDom() })
afterAll(() => { mock.restore() })

const preview = {
  bankId: 'main',
  conflicts: 1,
  edits: [
    { path: 'lessons/workflow/plain--aaa.md', kind: 'update' as const, diff: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new' },
    { path: 'lessons/correction/changed--bbb.md', kind: 'update' as const, conflict: 'rule-changed' as const, diff: '--- a\n+++ b\n@@ -1 +1 @@\n-before\n+after' },
  ],
}

function setApi(api: Record<string, unknown>): void {
  Object.assign(window, { electronAPI: api })
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  await act(async () => { await promise })
}

function byTestId(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
}
function allByTestId(container: HTMLElement, id: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`))
}
async function click(node: HTMLElement | null): Promise<void> {
  if (!node) throw new Error('element missing')
  await act(async () => { node.click() })
  await flush()
}

describe('ImportReviewDialog', () => {
  it('renders every edit with conflict badges and diff previews', async () => {
    setApi({ previewMemoryRepoImport: mock(async () => preview) })
    const { container, root } = await render(<ImportReviewDialog bankId="main" open onOpenChange={() => {}} />)
    await flush()

    expect(allByTestId(container, 'import-edit')).toHaveLength(2)
    expect(allByTestId(container, 'import-conflict')).toHaveLength(1)
    expect(byTestId(container, 'import-conflict')?.textContent).toContain('memory.repo.import.conflictRuleChanged')
    expect(allByTestId(container, 'import-edit-diff')).toHaveLength(2)
    await root.unmount()
  })

  it('applies only checked paths, and a conflicting path only after «Переопределить»', async () => {
    const apply = mock(async () => ({ applied: 0 }))
    setApi({ previewMemoryRepoImport: mock(async () => preview), applyMemoryRepoImport: apply })
    const { container, root } = await render(<ImportReviewDialog bankId="main" open onOpenChange={() => {}} />)
    await flush()

    // The rule-changed edit is selected but not overridden yet → excluded.
    await click(byTestId(container, 'import-apply'))
    expect(apply).toHaveBeenNthCalledWith(1, 'main', ['lessons/workflow/plain--aaa.md'])

    // Checked override adds the conflicting path.
    await click(byTestId(container, 'import-edit-override'))
    await click(byTestId(container, 'import-apply'))
    expect(apply).toHaveBeenNthCalledWith(2, 'main', ['lessons/workflow/plain--aaa.md', 'lessons/correction/changed--bbb.md'])

    // Unchecking a path drops it from the next apply.
    await click(allByTestId(container, 'import-edit-select')[0]!)
    await click(byTestId(container, 'import-apply'))
    expect(apply).toHaveBeenNthCalledWith(3, 'main', ['lessons/correction/changed--bbb.md'])
    await root.unmount()
  })

  it('reverts only after an explicit confirmation', async () => {
    const revert = mock(async () => ({ reverted: 0 }))
    setApi({ previewMemoryRepoImport: mock(async () => preview), revertMemoryRepoImport: revert })
    const { container, root } = await render(<ImportReviewDialog bankId="main" open onOpenChange={() => {}} />)
    await flush()

    await click(byTestId(container, 'import-revert'))
    expect(revert).not.toHaveBeenCalled()
    expect(byTestId(container, 'import-revert-confirm')).not.toBeNull()

    await click(byTestId(container, 'import-revert-confirm-button'))
    expect(revert).toHaveBeenCalledWith('main')
    await root.unmount()
  })

  it('ignores the footer «Отмена» while an apply is in flight, then allows it again', async () => {
    const pending = Promise.withResolvers<unknown>()
    const apply = mock(() => pending.promise)
    setApi({ previewMemoryRepoImport: mock(async () => preview), applyMemoryRepoImport: apply })
    const onOpenChange = mock(() => {})
    const { container, root } = await render(<ImportReviewDialog bankId="main" open onOpenChange={onOpenChange} />)
    await flush()

    // Start an apply; the RPC stays in flight.
    await click(byTestId(container, 'import-apply'))
    expect(apply).toHaveBeenCalledTimes(1)

    const cancel = byTestId(container, 'import-cancel') as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    await click(cancel)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(byTestId(container, 'import-review-dialog')).not.toBeNull()

    // A failed apply keeps the dialog open and clears the busy state.
    await act(async () => { pending.reject(new Error('boom')); await Promise.resolve() })
    await flush()
    expect(cancel.disabled).toBe(false)
    await click(cancel)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await root.unmount()
  })
})