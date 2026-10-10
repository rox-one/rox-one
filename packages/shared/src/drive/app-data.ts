/**
 * App-data coverage inventory for the Drive «Данные приложения» section (R13).
 *
 * R13 («…все данные приложения там») says all application data should live in
 * ROX Drive. Today only part of it does, so this module is the single source
 * of truth the surface renders: every status names the mechanism that actually
 * stores the data (or the reason it is not stored), with a comment pointing at
 * the implementing code. The renderer never invents a per-source percentage or
 * a live progress figure — a capability, not a fabricated measurement.
 *
 * Honest today (2026-10-10):
 *  - `uploads` / `cloud-imports` — bytes the user adds to the Drive surface or
 *    copies from a cloud provider are stored in ROX Drive: the device-local
 *    index (`apps/electron/src/main/drive/local-drive.ts`) or the self-hosted
 *    S3 target (`packages/shared/src/drive/importers/r2-target.ts`).
 *  - `device-folders` — the five standard folders (Загрузки / Документы /
 *    Изображения / Рабочий стол / Скриншоты) can be copied into ROX Drive on
 *    demand through `BackupChooser` (`drive:scanSource` → upload queue).
 *    Nothing runs automatically.
 *  - `app-config` — the app's own config directory (settings, workspaces, chat
 *    sessions, Keeper vault) can be mirrored into ROX Drive on demand through
 *    the R13 mirror engine (`apps/electron/src/main/drive/mirror.ts` →
 *    `drive:mirror*`). Nothing runs automatically: the engine only exists when
 *    the host has an S3 destination configured (`ROX_DRIVE_S3_*`).
 */

/** How (or whether) a slice of app data reaches ROX Drive today. */
export type DriveAppDataStatus =
  /** Stored in ROX Drive whenever the user adds it. */
  | 'in-drive'
  /** Not stored yet, but the user can copy or mirror it in on demand. */
  | 'on-demand'
  /** Not stored, and no engine exists to do so. No entry uses this today. */
  | 'not-backed-up'

export interface DriveAppDataEntry {
  /** Stable id; also the `<id>` segment of the i18n keys below. */
  id: 'uploads' | 'cloud-imports' | 'device-folders' | 'app-config'
  status: DriveAppDataStatus
  /** i18n key for the entry title (see `drive.appData.entry.*.title`). */
  titleKey: string
  /** i18n key for the honest one-line detail. */
  detailKey: string
}

/** Where the shared `status` enum maps into the locale catalog. */
export const DRIVE_APP_DATA_STATUS_I18N_KEY: Record<DriveAppDataStatus, string> = {
  'in-drive': 'drive.appData.status.inDrive',
  'on-demand': 'drive.appData.status.onDemand',
  'not-backed-up': 'drive.appData.status.notBackedUp',
}

export const DRIVE_APP_DATA_ENTRIES: readonly DriveAppDataEntry[] = [
  {
    id: 'uploads',
    status: 'in-drive',
    titleKey: 'drive.appData.entry.uploads.title',
    detailKey: 'drive.appData.entry.uploads.detail',
  },
  {
    id: 'cloud-imports',
    status: 'in-drive',
    titleKey: 'drive.appData.entry.cloudImports.title',
    detailKey: 'drive.appData.entry.cloudImports.detail',
  },
  {
    id: 'device-folders',
    status: 'on-demand',
    titleKey: 'drive.appData.entry.deviceFolders.title',
    detailKey: 'drive.appData.entry.deviceFolders.detail',
  },
  {
    id: 'app-config',
    status: 'on-demand',
    titleKey: 'drive.appData.entry.appConfig.title',
    detailKey: 'drive.appData.entry.appConfig.detail',
  },
] as const