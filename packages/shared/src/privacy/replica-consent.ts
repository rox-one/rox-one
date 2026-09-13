import { AccountReplica, REPLICA_CATEGORIES } from '../account-replica/index.ts'
import { replicaAppendAllowed, replicaRealtimeAllowed } from './policy.ts'
import type { ConsentPurposes } from './types.ts'

/**
 * Apply DG-01 purposes onto an already-constructed replica.
 * Existing replica tests stay opt-in: they never call this helper, so
 * default category controls remain unchanged.
 */
export function applyConsentToReplica(replica: AccountReplica, purposes: ConsentPurposes): void {
  const replicaOn = replicaAppendAllowed(purposes)
  const realtime = replicaRealtimeAllowed(purposes)
  for (const category of REPLICA_CATEGORIES) {
    replica.setCategoryControl(category, replicaOn, realtime)
  }
}
