/**
 * W1-04 (#1501) — `contacts.dossier-export.v1` is registered default OFF and
 * the server-side check mirrors the workbench flag id.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { WORKBENCH_FEATURE_FLAGS, WORKBENCH_FLAG } from '../../../core/src/platform/workbench/flags.ts'
import { DOSSIER_EXPORT_WORKBENCH_FLAG, isDossierExportEnabled } from '../feature-flags.ts'

const previous = process.env.CRAFT_FEATURE_DOSSIER_EXPORT
afterEach(() => {
  if (previous === undefined) delete process.env.CRAFT_FEATURE_DOSSIER_EXPORT
  else process.env.CRAFT_FEATURE_DOSSIER_EXPORT = previous
})

describe('contacts.dossier-export.v1', () => {
  it('is registered default OFF with a matching literal', () => {
    expect(WORKBENCH_FLAG.contactsDossierExportV1).toBe(DOSSIER_EXPORT_WORKBENCH_FLAG)
    expect(WORKBENCH_FEATURE_FLAGS.find(flag => flag.id === DOSSIER_EXPORT_WORKBENCH_FLAG))
      .toEqual({ id: DOSSIER_EXPORT_WORKBENCH_FLAG, defaultValue: false, dependencies: [], rollbackSafe: true })
  })

  it('is disabled unless the flag or the env override enables it', () => {
    delete process.env.CRAFT_FEATURE_DOSSIER_EXPORT
    expect(isDossierExportEnabled()).toBe(false)
    expect(isDossierExportEnabled(new Set())).toBe(false)
    expect(isDossierExportEnabled(new Set([DOSSIER_EXPORT_WORKBENCH_FLAG]))).toBe(true)
    process.env.CRAFT_FEATURE_DOSSIER_EXPORT = '0'
    expect(isDossierExportEnabled(new Set([DOSSIER_EXPORT_WORKBENCH_FLAG]))).toBe(false)
    process.env.CRAFT_FEATURE_DOSSIER_EXPORT = '1'
    expect(isDossierExportEnabled()).toBe(true)
  })
})
