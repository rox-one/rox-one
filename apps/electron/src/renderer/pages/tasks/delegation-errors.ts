import { PersonalTaskLinkError } from '@/features/product-tour/adapters/work/tasks-projects/native-commit'

export type TaskDelegationErrorKey =
  | 'tasks.delegate.error.taskChanged'
  | 'tasks.delegate.error.writeUnconfirmed'
  | 'tasks.delegate.error.readBackFailed'
  | 'tasks.delegate.error.unavailable'

/** Keep raw storage/RPC errors out of user-facing task delegation messages. */
export function taskDelegationErrorKey(error: unknown): TaskDelegationErrorKey {
  if (error instanceof PersonalTaskLinkError) {
    switch (error.code) {
      case 'revision-conflict': return 'tasks.delegate.error.taskChanged'
      case 'write-unconfirmed': return 'tasks.delegate.error.writeUnconfirmed'
      case 'readback-failed': return 'tasks.delegate.error.readBackFailed'
    }
  }
  return 'tasks.delegate.error.unavailable'
}
