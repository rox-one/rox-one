/**
 * Generated long-chat fixture (#1589): deterministic N-turn conversation with
 * tool calls, intermediate text, status/compaction, auth requests and
 * occasional errors, for windowing / incremental grouping tests and benches.
 */
import type { Message } from '@rox/core/types'

export function generateLongChat(turnPairs = 2000, seed = 1): Message[] {
  let s = seed
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  const messages: Message[] = []
  let t = 1_700_000_000_000
  let id = 0
  const push = (m: Partial<Message> & Pick<Message, 'role'>) => {
    messages.push({ id: `m${id++}`, content: '', timestamp: t++, ...m } as Message)
  }
  for (let i = 0; i < turnPairs; i++) {
    push({ role: 'user', content: `Question ${i}: how do I fix bug #${i}?` })
    const turnId = `turn-${i}`
    const tools = Math.floor(rand() * 3)
    for (let k = 0; k < tools; k++) {
      push({ role: 'assistant', content: `Looking at file ${k}`, isIntermediate: true, turnId })
      push({ role: 'tool', toolName: 'Read', toolUseId: `tu-${i}-${k}`, toolInput: { file_path: `/f${k}.ts` }, content: 'ok', toolStatus: 'completed', turnId } as Partial<Message> & Pick<Message, 'role'>)
    }
    if (i % 97 === 5) push({ role: 'error', content: `Error in turn ${i}` })
    if (i % 211 === 7) push({ role: 'auth-request', content: 'Need credentials', authRequestId: `auth-${i}` } as Partial<Message> & Pick<Message, 'role'>)
    push({ role: 'assistant', content: `Answer ${i}: **bold** and \`code\`.\n\n- item`, turnId })
  }
  return messages
}
