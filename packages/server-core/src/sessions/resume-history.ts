import type {Message} from '@craft-agent/core/types';

/** The active submission is already persisted before backend startup; replay it only once. */
export function selectResumeHistory(messages: Message[], hasPendingUserSubmission: boolean): Message[] {
  if(!hasPendingUserSubmission)return messages.slice();
  const current=messages.findLastIndex(m=>m.role==='user');
  return current<0?messages.slice():messages.slice(0,current);
}
