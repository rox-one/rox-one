import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '../../NotesPage.tsx'), 'utf8')

const TOAST_KEYS = [
  'notes.toast.assetDeleted',
  'notes.toast.changedOnDisk',
  'notes.toast.changedOnDiskDesc',
  'notes.toast.cleanAssetsFailed',
  'notes.toast.cleanedAssets',
  'notes.toast.deleteAssetFailed',
  'notes.toast.deleteFolderFailed',
  'notes.toast.exportedPdf',
  'notes.toast.importAssetFailed',
  'notes.toast.importedAssets',
  'notes.toast.moveFailed',
  'notes.toast.openFailed',
  'notes.toast.propertyKeyInvalid',
  'notes.toast.readFileFailed',
  'notes.toast.reload',
  'notes.toast.renameAssetFailed',
  'notes.toast.renameFolderFailed',
  'notes.toast.saveFailed',
  'notes.toast.searchFailed',
  'notes.toast.updatePropertiesFailed',
  'notes.toast.updatedNotes',
  'notes.toast.watchFailed',
] as const

describe('notes toasts are i18n', () => {
  it('uses notes.toast keys instead of hardcoded English', () => {
    for (const key of TOAST_KEYS) {
      expect(source).toContain(`t('${key}'`)
    }
    expect(source).not.toContain("'Failed to open note'")
    expect(source).not.toContain("'Failed to watch notes'")
    expect(source).not.toContain("'Failed to save note'")
    expect(source).not.toContain("'Failed to search notes'")
    expect(source).not.toContain("'Failed to move note'")
    expect(source).not.toContain("'Failed to rename folder'")
    expect(source).not.toContain("'Failed to delete folder'")
    expect(source).not.toContain("'Failed to update note properties'")
    expect(source).not.toContain("'Failed to import asset'")
    expect(source).not.toContain("'Failed to rename asset'")
    expect(source).not.toContain("'Failed to delete asset'")
    expect(source).not.toContain("'Failed to clean assets'")
    expect(source).not.toContain("'Note changed on disk'")
    expect(source).not.toContain("'Exported to PDF'")
    expect(source).not.toContain("'Asset deleted'")
    expect(source).not.toContain("'Could not read selected file'")
  })
})
