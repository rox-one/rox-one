import type { ExtensionStatus } from './types.ts'

/** Installed list totals — disabled records stay in `total` and are counted separately. */
export function countInstalledExtensionRecords(
  records: ReadonlyArray<{ status: ExtensionStatus }>,
): { total: number; disabled: number; enabled: number } {
  const disabled = records.filter((r) => r.status === 'disabled').length
  return {
    total: records.length,
    disabled,
    enabled: records.length - disabled,
  }
}
