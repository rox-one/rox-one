import { describe, expect, it } from 'bun:test'
import { getSessionsRequiringPermissionModeReconcile } from '../permission-mode-reconcile'

describe('getSessionsRequiringPermissionModeReconcile', () => {
  it('reconciles only legacy session payloads without permissionModeVersion', () => {
    expect(getSessionsRequiringPermissionModeReconcile([
      { id: 'current-zero', permissionModeVersion: 0 },
      { id: 'current-newer', permissionModeVersion: 4 },
      { id: 'legacy-missing' },
      { id: 'legacy-null', permissionModeVersion: null as unknown as number },
    ])).toEqual(['legacy-missing', 'legacy-null'])
  })
})
