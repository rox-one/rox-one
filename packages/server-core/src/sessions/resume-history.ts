import type {Message} from '@rox/core/types';

/** The active submission is already persisted before backend startup; replay it only once. */
export function selectResumeHistory(messages: Message[], activeUserMessageId?: string, queuedMessageIds: string[] = []): Message[] {
  const current = activeUserMessageId ? messages.findIndex(m => m.id === activeUserMessageId) : -1;
  if (activeUserMessageId && current < 0) throw new Error('Active ROX submission is missing from persisted history');
  const queued = new Set(queuedMessageIds);
  return (current < 0 ? messages : messages.slice(0, current)).filter(m => !queued.has(m.id));
}
