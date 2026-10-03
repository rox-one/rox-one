/** Persisted transcript fixture for scroll continuity; never runtime observations. */
import type { Message } from '../../../packages/core/src/types'

export function createChatHistoryFixture(): Message[] {
  return Array.from({ length: 20 }, (_, index) => [
    { id: `history-user-${index}`, role: 'user' as const, content: `Исторический запрос ${index + 1}`, timestamp: 1_000 + index * 2 },
    { id: `history-assistant-${index}`, role: 'assistant' as const,
      content: `Сохранённый ответ ${index + 1}. ${'Проверяем сохранение видимой позиции в настоящем чате. '.repeat(6)}`,
      timestamp: 1_001 + index * 2, turnId: `history-turn-${index}` },
  ]).flat()
}
