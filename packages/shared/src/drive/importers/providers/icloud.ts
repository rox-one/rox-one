/**
 * iCloud Drive import provider — honestly unsupported.
 *
 * iCloud Drive has no public file/storage API (CloudKit is a record store, not
 * a file API, and the `icloud` scheme is device-local). Rather than fake a
 * provider, the factory returns an `ImportProvider` whose every operation fails
 * with a typed, Russian `unsupported` error.
 */
import type { ImportProvider, ImportProviderId, ImportSourceEntry } from '../types'
import { ImportProviderError } from './auth'

export const ICLOUD_UNSUPPORTED_MESSAGE =
  'iCloud Drive не предоставляет публичный файловый API, поэтому импорт из iCloud недоступен.'

/** An `ImportProvider` that always reports a clear, typed failure. */
export class UnsupportedImportProvider implements ImportProvider {
  readonly id: ImportProviderId
  private readonly reason: string

  constructor(id: ImportProviderId, reason: string) {
    this.id = id
    this.reason = reason
  }

  async list(_folderId?: string): Promise<ImportSourceEntry[]> {
    throw new ImportProviderError(this.reason, { code: 'unsupported', provider: this.id })
  }

  async stream(_sourceId: string, _range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array>> {
    throw new ImportProviderError(this.reason, { code: 'unsupported', provider: this.id })
  }
}

/** Factory for the iCloud import provider (always unsupported). */
export function createICloudProvider(): UnsupportedImportProvider {
  return new UnsupportedImportProvider('icloud', ICLOUD_UNSUPPORTED_MESSAGE)
}