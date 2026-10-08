/**
 * W1-04 (#1501) — Local contacts: directory read model, offline contact
 * cards and the MIG-06 Dossier import (TECH-SPEC §3.6, §4.6).
 */

export * from './types.ts'
export { buildLocalDirectory, MAX_MANAGER_CHAIN, type BuildDirectoryInput, type DirectoryReadModel, type DirectoryViewer } from './directory.ts'
export { CONTACT_STORE_VERSION, ContactCardStore, ContactCardStoreError } from './store.ts'
export {
  DOSSIER_EXPORT_SCHEMA_VERSION,
  DossierImportError,
  MAX_DOSSIER_ENTITIES,
  dossierCardId,
  dossierToContactCards,
  importDossier,
  parseDossierExport,
  type DossierEntityExport,
  type DossierImportResult,
  type DossierParseError,
  type DossierPromiseExport,
} from './dossier-import.ts'
