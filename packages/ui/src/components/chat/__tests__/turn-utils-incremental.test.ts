import { describe, it, expect } from 'bun:test'
import type { Message } from '@rox/core/types'
import { createIncrementalTurnGrouper, groupMessagesByTurn } from '../turn-utils'
import { generateLongChat } from './fixtures/long-chat'

const strip = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('createIncrementalTurnGrouper (#1589)', () => {
  it('2000-turn fixture: first group equals full grouping', () => {
    const msgs = generateLongChat(2000)
    const g = createIncrementalTurnGrouper()
    const turns = g.group(msgs, { isSessionProcessing: false })
    expect(turns.length).toBeGreaterThanOrEqual(4000)
    expect(strip(turns)).toEqual(strip(groupMessagesByTurn(msgs, { isSessionProcessing: false })))
  })

  it('streaming appends match full grouping and keep prefix turn identity', () => {
    const base = generateLongChat(2000)
    const g = createIncrementalTurnGrouper()
    const first = g.group(base, { isSessionProcessing: true })
    let msgs = [...base]
    let t = msgs[msgs.length - 1]!.timestamp + 1
    msgs = [...msgs, { id: 'u-new', role: 'user', content: 'next', timestamp: t++ } as Message]
    let turns = g.group(msgs, { isSessionProcessing: true })
    // every turn through the last earlier user boundary keeps its identity;
    // only the open tail after it is regrouped
    let lastUser = first.length - 1
    while (first[lastUser]!.type !== 'user') lastUser--
    for (let i = 0; i <= lastUser; i++) expect(turns[i]).toBe(first[i])
    expect(strip(turns.slice(0, first.length))).toEqual(strip(first))
    const newUserTurn = turns[first.length]
    // stream a response: replace the last message object on each delta
    let content = ''
    msgs = [...msgs, { id: 'a-new', role: 'assistant', content, isStreaming: true, timestamp: t++, turnId: 'tn' } as Message]
    for (let d = 0; d < 20; d++) {
      content += ` tok${d}`
      const last = msgs[msgs.length - 1]!
      msgs = [...msgs.slice(0, -1), { ...last, content }]
      turns = g.group(msgs, { isSessionProcessing: true })
      expect(turns[first.length]).toBe(newUserTurn)
      expect(turns[lastUser]).toBe(first[lastUser])
    }
    expect(strip(turns)).toEqual(strip(groupMessagesByTurn(msgs, { isSessionProcessing: true })))
    msgs = [...msgs.slice(0, -1), { ...msgs[msgs.length - 1]!, isStreaming: false }]
    expect(strip(g.group(msgs, { isSessionProcessing: false }))).toEqual(strip(groupMessagesByTurn(msgs, { isSessionProcessing: false })))
  })

  it('mid-history edits, removals, hidden and out-of-order messages stay correct', () => {
    const g = createIncrementalTurnGrouper()
    let msgs = generateLongChat(300, 7)
    g.group(msgs)
    const check = () => expect(strip(g.group(msgs))).toEqual(strip(groupMessagesByTurn(msgs)))
    msgs = msgs.map((m, i) => (i === 50 ? { ...m, content: 'edited' } : m)); check()
    msgs = msgs.filter((_, i) => i !== 120); check()
    msgs = msgs.map((m, i) => (i === 10 ? { ...m, hidden: true } : m)); check()
    msgs = [...msgs, { id: 'late', role: 'assistant', content: 'late', timestamp: msgs[200]!.timestamp, isIntermediate: true } as Message]; check()
    msgs = msgs.slice(0, 40); check()
    msgs = []; check()
  })

  it('streaming delta on 2000 turns regroups only the open tail (structural, no timing)', () => {
    const msgs = generateLongChat(2000)
    const g = createIncrementalTurnGrouper()
    const first = g.group(msgs)
    expect(g.lastStats()).toEqual({ regroupedMessages: msgs.length, reusedTurns: 0 })
    let lastUser = first.length - 1
    while (first[lastUser]!.type !== 'user') lastUser--
    const tailMessages = msgs.length - 1 - msgs.map(m => m.role).lastIndexOf('user')
    let cur = [...msgs, { id: 'x', role: 'assistant', content: '', isStreaming: true, timestamp: Number.MAX_SAFE_INTEGER - 100 } as Message]
    for (let i = 0; i < 30; i++) {
      cur = [...cur.slice(0, -1), { ...cur[cur.length - 1]!, content: 'x'.repeat(i) }]
      const turns = g.group(cur)
      const st = g.lastStats()
      expect(st.reusedTurns).toBe(lastUser + 1)
      expect(st.regroupedMessages).toBe(tailMessages + 1)
      expect(st.regroupedMessages).toBeLessThan(20)
      for (let k = 0; k <= lastUser; k += 97) expect(turns[k]).toBe(first[k])
      expect(turns[lastUser]).toBe(first[lastUser])
    }
  })
})
