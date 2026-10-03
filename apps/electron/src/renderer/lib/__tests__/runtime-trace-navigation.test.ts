import { expect,test } from 'bun:test'
import type { Message } from '@rox/core'
import { createRuntimeTraceFixture } from '@rox/core/runtime-trace/fixture'
import { resolveChatAnchor,resolveRuntimeEventForMessage } from '../runtime-trace-navigation'
const fixture=createRuntimeTraceFixture()
test('runtime/chat navigation preserves mounted optimistic identity',()=>{
  const messages=[{id:'optimistic',backendMessageId:'fixture-user',role:'user',content:'Prompt',timestamp:1}] as Message[]
  expect(resolveChatAnchor(fixture[0]!,messages).messageId).toBe('optimistic')
  expect(resolveRuntimeEventForMessage(fixture,messages,'optimistic')?.eventId).toBe('fixture:1')
})
test('tool identity resolves without message text heuristics',()=>{
  const messages=[{id:'tool-row',role:'tool',content:'',timestamp:1,toolUseId:'fixture-read'}] as Message[]
  expect(resolveChatAnchor(fixture[9]!,messages).messageId).toBe('tool-row')
})
