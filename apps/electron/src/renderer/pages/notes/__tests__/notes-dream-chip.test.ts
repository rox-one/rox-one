/**
 * Notes dream chip + delete-dialog sleep copy.
 *
 * The chip is asserted by MOUNTING `NotesNavigationSidebar` and reading the
 * rendered DOM (`data-testid`, `data-dream-state`, label) — not by grepping the
 * `.tsx` sources, which could never fail on a behaviour regression. The delete
 * dialog's sleep copy is asserted the same way through the real `NotesDialogs`
 * component with only the delete dialog open.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
// Keep every real export (notably `setI18n`) in the mocked namespace so this
// process-wide stub cannot break a sibling file that imports a named export.
import * as actualReactI18next from 'react-i18next'
import { useDomForFile, resetDom } from '../../../../../../../packages/ui/src/components/primitives/__tests__/dom-env'
import type { NoteSummary } from '../../../../shared/types'
import type { NotesNavigationSidebar as NotesNavigationSidebarComponent } from '../NotesNavigationSidebar'
import type { NotesDialogs as NotesDialogsComponent } from '../NotesDialogs'

useDomForFile()

// Presentation-only primitives are not the subject: stub i18n (keys pass
// through), dnd-kit, the radix context menu and the dialog shell so the chip
// and the delete copy mount deterministically in happy-dom.
mock.module('react-i18next', () => ({
  ...actualReactI18next,
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}))
mock.module('@dnd-kit/core', () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ isOver: false, setNodeRef: () => {} }),
}))
mock.module('@/components/ui/styled-context-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children)
  const Item = ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { type: 'button', onClick }, children)
  return {
    ContextMenu: Pass,
    ContextMenuTrigger: Pass,
    StyledContextMenuContent: Pass,
    StyledContextMenuItem: Item,
    StyledContextMenuSeparator: () => null,
  }
})
mock.module('@/components/ui/rename-dialog', () => ({ RenameDialog: () => null }))
// The dialog shell renders its content only while `open` — the asset/rename
// dialogs never mount their heavy children here.
mock.module('@/components/ui/dialog', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  const Gate = ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? React.createElement('div', null, children) : null
  return {
    Dialog: Gate,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: Box,
    DialogDescription: Box,
    DialogFooter: Box,
  }
})
mock.module('@/pages/notes/NoteInspector', () => ({ AssetThumbnail: () => null, formatBytes: (n: number) => String(n) }))

let noteDreamState: (ids: ReadonlySet<string> | null | undefined, noteId: string) => 'pending' | 'dreamed' | null
let NotesNavigationSidebar: typeof NotesNavigationSidebarComponent
let NotesDialogs: typeof NotesDialogsComponent

// Static import would evaluate the sidebar's dnd-kit/radix graph before the DOM
// globals exist; import after useDomForFile() and the mocks instead.
beforeAll(async () => {
  const sidebar = await import('../NotesNavigationSidebar')
  noteDreamState = sidebar.noteDreamState
  NotesNavigationSidebar = sidebar.NotesNavigationSidebar
  const dialogs = await import('../NotesDialogs')
  NotesDialogs = dialogs.NotesDialogs
})

afterEach(() => { resetDom() })
afterAll(() => { mock.restore() })

const note = (id: string): NoteSummary => ({
  id,
  title: id,
  path: id,
  relativePath: id,
  tags: [],
  properties: {},
  links: [],
  assetRefs: [],
  updatedAt: 0,
  createdAt: 0,
  size: 0,
})

const sidebarActions = {
  onOpenNote: () => {},
  onOpenCreateNoteDialog: () => {},
  onOpenRenameFolder: () => {},
  onOpenDeleteFolder: () => {},
  onOpenMoveDialog: () => {},
  onOpenRenameDialogForNote: () => {},
  onOpenDeleteDialogForNote: () => {},
  onDuplicateNote: () => {},
  onCollectToMemory: () => {},
  onCopyNoteLink: () => {},
  onCopyNotePath: () => {},
  onRevealNote: () => {},
}

const dialogsProps = {
  createDialogOpen: false,
  createTitle: '',
  createInFolder: undefined,
  onCreateDialogOpenChange: () => {},
  onCreateTitleChange: () => {},
  onCreateNote: () => {},
  createFolderDialogOpen: false,
  createFolderName: '',
  onCreateFolderDialogOpenChange: () => {},
  onCreateFolderNameChange: () => {},
  onCreateFolder: () => {},
  moveDialogOpen: false,
  moveTargetNote: null,
  moveFolderName: '',
  onMoveDialogOpenChange: () => {},
  onMoveFolderNameChange: () => {},
  onMoveNote: () => {},
  renameDialogOpen: false,
  renameTitle: '',
  renameImpact: null,
  activeNote: null,
  onRenameDialogOpenChange: () => {},
  onRenameTitleChange: () => {},
  onRenameNote: () => {},
  deleteDialogOpen: true,
  onDeleteDialogOpenChange: () => {},
  onDeleteNote: () => {},
  missingLinkTarget: null,
  onDismissMissingLink: () => {},
  onCreateMissingLink: () => {},
  assetDialogOpen: false,
  allAssets: [],
  orphanAssets: [],
  assetBusy: false,
  onAssetDialogOpenChange: () => {},
  onImportAsset: () => {},
  onCleanUnusedAssets: () => {},
  onOpenFile: () => {},
  onOpenAssetRenameDialog: () => {},
  onDeleteAsset: () => {},
  assetRenameTarget: null,
  assetRenameName: '',
  onAssetRenameTargetChange: () => {},
  onAssetRenameNameChange: () => {},
  onRenameAsset: () => {},
  renameFolderDialogOpen: false,
  renameFolderTarget: '',
  renameFolderName: '',
  onRenameFolderDialogOpenChange: () => {},
  onRenameFolderNameChange: () => {},
  onRenameFolder: () => {},
  deleteFolderDialogOpen: false,
  deleteFolderTarget: '',
  deleteFolderNoteCount: 0,
  onDeleteFolderDialogOpenChange: () => {},
  onDeleteFolder: () => {},
}

async function render(node: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(node) })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

function chipFor(container: HTMLElement, noteId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-note-id="${noteId}"] [data-testid="notes-dream-chip"]`)
}

describe('notes dream chip', () => {
  it('marks a note pending when it is in pendingNoteIds, dreamed otherwise', () => {
    const pending = new Set(['journal/today.md'])
    expect(noteDreamState(pending, 'journal/today.md')).toBe('pending')
    expect(noteDreamState(pending, 'journal/yesterday.md')).toBe('dreamed')
    expect(noteDreamState(new Set(), 'journal/today.md')).toBe('dreamed')
  })

  it('hides the chip while the dream status is unknown', () => {
    expect(noteDreamState(null, 'journal/today.md')).toBeNull()
    expect(noteDreamState(undefined, 'journal/today.md')).toBeNull()
  })

  it('renders the pending chip for a queued note and the dreamed chip otherwise', async () => {
    const { container, root } = await render(
      React.createElement(NotesNavigationSidebar, {
        notes: [note('journal/today.md'), note('journal/yesterday.md')],
        activeNoteId: null,
        collapsedFolders: new Set<string>(),
        onToggleFolder: () => {},
        emptyMessage: 'empty',
        dreamNoteIds: new Set(['journal/today.md']),
        ...sidebarActions,
      }),
    )

    const pending = chipFor(container, 'journal/today.md')
    expect(pending).not.toBeNull()
    expect(pending!.getAttribute('data-dream-state')).toBe('pending')
    expect(pending!.textContent).toBe('notes.sleep.pending')

    const dreamed = chipFor(container, 'journal/yesterday.md')
    expect(dreamed).not.toBeNull()
    expect(dreamed!.getAttribute('data-dream-state')).toBe('dreamed')
    expect(dreamed!.textContent).toBe('notes.sleep.dreamed')

    await unmount(root)
  })

  it('renders no chip at all while the dream status is unknown', async () => {
    const { container, root } = await render(
      React.createElement(NotesNavigationSidebar, {
        notes: [note('journal/today.md')],
        activeNoteId: null,
        collapsedFolders: new Set<string>(),
        onToggleFolder: () => {},
        emptyMessage: 'empty',
        dreamNoteIds: null,
        ...sidebarActions,
      }),
    )

    expect(chipFor(container, 'journal/today.md')).toBeNull()

    await unmount(root)
  })

  it('renders the sleep copy in the delete dialog from the wired i18n key', async () => {
    const { container, root } = await render(React.createElement(NotesDialogs, dialogsProps))

    const sleepCopy = container.querySelector<HTMLElement>('[data-testid="notes-delete-sleep"]')
    expect(sleepCopy).not.toBeNull()
    expect(sleepCopy!.textContent).toBe('notes.dialog.deleteNoteSleep')

    await unmount(root)
  })

  it('invokes onCollectToMemory with the note from the context menu', async () => {
    const collected: string[] = []
    const { container, root } = await render(
      React.createElement(NotesNavigationSidebar, {
        notes: [note('journal/today.md')],
        activeNoteId: null,
        collapsedFolders: new Set<string>(),
        onToggleFolder: () => {},
        emptyMessage: 'empty',
        dreamNoteIds: null,
        ...sidebarActions,
        onCollectToMemory: (target) => { collected.push(target.id) },
      }),
    )

    const item = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'notes.action.collectToMemory')
    expect(item).not.toBeUndefined()
    await act(async () => { item!.click() })
    expect(collected).toEqual(['journal/today.md'])

    await unmount(root)
  })
})