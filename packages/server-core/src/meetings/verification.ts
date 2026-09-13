import type { OperationResultV2 } from '@craft-agent/core/meetings'
import { isUiVerified } from '@craft-agent/core/meetings'

export function verificationLabel(result: OperationResultV2): 'verified' | 'unknown' | 'pending' {
  if (isUiVerified(result)) return 'verified'
  if (result.verification === 'pending') return 'pending'
  return 'unknown'
}
