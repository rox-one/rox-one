import type { OperationResultV2 } from '@rox/core/meetings'
import { isUiVerified } from '@rox/core/meetings'

export function verificationLabel(result: OperationResultV2): 'verified' | 'unknown' | 'pending' {
  if (isUiVerified(result)) return 'verified'
  if (result.verification === 'pending') return 'pending'
  return 'unknown'
}
