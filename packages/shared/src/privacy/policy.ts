import {
  EXCLUDED_TRAINING_CATEGORIES,
  type ConsentPurpose,
  type ConsentPurposes,
  type PrivacyState,
} from './types.ts'

export type PurposeDecision =
  | { ok: true; purpose: ConsentPurpose }
  | { ok: false; purpose: ConsentPurpose; reason: 'disabled' | 'excluded-category' }

export function isPurposeAllowed(purposes: ConsentPurposes, purpose: ConsentPurpose): boolean {
  return purposes[purpose] === true
}

export function decidePurpose(state: PrivacyState, purpose: ConsentPurpose): PurposeDecision {
  if (!isPurposeAllowed(state.purposes, purpose)) {
    return { ok: false, purpose, reason: 'disabled' }
  }
  return { ok: true, purpose }
}

/** Replica writes require recovery consent. Realtime additionally requires sync. */
export function replicaAppendAllowed(purposes: ConsentPurposes): boolean {
  return purposes.accountRecoveryReplica === true
}

export function replicaRealtimeAllowed(purposes: ConsentPurposes): boolean {
  return purposes.accountRecoveryReplica === true && purposes.realtimeSync === true
}

export function cloudInferenceAllowed(purposes: ConsentPurposes): boolean {
  return purposes.cloudInference === true
}

export function aiIndexingAllowed(purposes: ConsentPurposes): boolean {
  return purposes.aiIndexing === true
}

export function productImprovementAllowed(purposes: ConsentPurposes): boolean {
  return purposes.productImprovement === true
}

export function assertNotTrainingCategory(category: string): void {
  if ((EXCLUDED_TRAINING_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`category "${category}" is excluded from replica and product-improvement payloads`)
  }
}

export function exportAllowlist(categories: readonly string[]): string[] {
  return categories.filter((category) => !(EXCLUDED_TRAINING_CATEGORIES as readonly string[]).includes(category))
}
