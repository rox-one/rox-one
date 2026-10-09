/**
 * External-import honest states (wave 1).
 *
 * Google Drive / OneDrive / iCloud / Yandex Disk importers do not exist yet and
 * no OAuth access is requested this wave. The tiles open these states instead,
 * and the `available: false` flag is the contract the surface and its tests pin.
 */
export type ExternalImportId = 'google' | 'other'

export interface ExternalImportNotice {
  id: ExternalImportId
  /** Wave-1 truth: the importer is not wired, nothing is connected. */
  available: false
  titleKey: string
  bodyKey: string
  /** Wave-2 providers the tile advertises; empty for the Google tile. */
  providers: readonly string[]
}

export const EXTERNAL_IMPORT_NOTICES: Record<ExternalImportId, ExternalImportNotice> = {
  google: {
    id: 'google',
    available: false,
    titleKey: 'drive.notice.google.title',
    bodyKey: 'drive.notice.google.body',
    providers: [],
  },
  other: {
    id: 'other',
    available: false,
    titleKey: 'drive.notice.other.title',
    bodyKey: 'drive.notice.other.body',
    providers: ['OneDrive', 'iCloud', 'Яндекс Диск'],
  },
}