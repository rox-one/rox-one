import { describe, expect, test } from 'bun:test'
import {
  DOMAIN_EVENT_TYPES,
  EventProjectionRegistry,
  REALTIME_EVENT_TYPES,
  TOPIC_KINDS,
  TopicLog,
  TopicSeqTracker,
  formatTopic,
  isDomainEventType,
  isKnownDomainEventType,
  normalizeTopic,
  parseTopic,
  topicAclTarget,
  type DomainEvent,
} from '../index.ts'

describe('topic grammar', () => {
  test('parses every topic kind and round-trips', () => {
    for (const topic of ['user:u1', 'channel:c-1', 'entity:task:abc', 'space:s', 'task-list:l', 'calendar:cal', 'doc:d', 'meeting:m', 'workspace:00000000-0000-4000-8000-000000000000']) {
      const parsed = parseTopic(topic)
      expect(parsed).not.toBeNull()
      expect(formatTopic(parsed!)).toBe(topic)
    }
    expect(TOPIC_KINDS.length).toBe(9)
  })

  test('rejects malformed topics, aliases, fragments and unknown kinds', () => {
    for (const bad of ['', 'user', 'user:', 'nope:1', 'entity:task', 'entity:unknownkind:1', 'entity:task:', 'user:a b', 'doc:../x', 'entity:task:id#frag', 42, null, 'x'.repeat(400)]) {
      expect(parseTopic(bad)).toBeNull()
    }
    expect(normalizeTopic('channel:abc')).toBe('channel:abc')
  })

  test('ACL targets map topic kinds onto entity refs', () => {
    expect(topicAclTarget(parseTopic('user:p1')!)).toEqual({ kind: 'self', principalId: 'p1' })
    expect(topicAclTarget(parseTopic('workspace:w')!)).toEqual({ kind: 'workspace', workspaceId: 'w' })
    expect(topicAclTarget(parseTopic('doc:d')!)).toEqual({ kind: 'entity', ref: { kind: 'note', id: 'd' } })
    expect(topicAclTarget(parseTopic('meeting:m')!)).toEqual({ kind: 'entity', ref: { kind: 'call', id: 'm' } })
    expect(topicAclTarget(parseTopic('entity:goal:g')!)).toEqual({ kind: 'entity', ref: { kind: 'goal', id: 'g' } })
  })

  test('realtime catalogue covers every topic kind', () => {
    for (const kind of TOPIC_KINDS) expect(REALTIME_EVENT_TYPES[kind].length).toBeGreaterThan(0)
    expect(REALTIME_EVENT_TYPES.user).toContain('system.pinged')
  })
})

describe('domain event types', () => {
  test('catalogue is unique and well-formed', () => {
    expect(new Set(DOMAIN_EVENT_TYPES).size).toBe(DOMAIN_EVENT_TYPES.length)
    for (const type of DOMAIN_EVENT_TYPES) expect(isDomainEventType(type)).toBe(true)
    expect(isKnownDomainEventType('system.pinged')).toBe(true)
    expect(isKnownDomainEventType('im.message.receive_v1')).toBe(true)
    expect(isDomainEventType('NoModule')).toBe(false)
    expect(isDomainEventType('a.')).toBe(false)
  })
})

describe('TopicLog seq + gap recovery', () => {
  const frame = (n: number) => ({ type: 'entity.updated', payload: { n }, at: 'now' })

  test('assigns strictly increasing seq per topic', () => {
    const log = new TopicLog({ epoch: 'e1' })
    expect(log.append('entity:task:a', frame(1)).seq).toBe(1)
    expect(log.append('entity:task:a', frame(2)).seq).toBe(2)
    expect(log.append('entity:task:b', frame(3)).seq).toBe(1)
    expect(log.latest('entity:task:a')).toBe(2)
  })

  test('replays the missing frames, or requires a snapshot', () => {
    const log = new TopicLog({ epoch: 'e1', capacity: 3 })
    for (let i = 1; i <= 5; i++) log.append('t:1', frame(i))
    expect(log.replay('t:1', 5, log.epoch)).toMatchObject({ kind: 'up_to_date', latestSeq: 5 })
    const replay = log.replay('t:1', 3, log.epoch)
    expect(replay.kind).toBe('events')
    if (replay.kind === 'events') expect(replay.frames.map(f => f.seq)).toEqual([4, 5])
    expect(log.replay('t:1', 1, log.epoch)).toMatchObject({ kind: 'snapshot_required', latestSeq: 5 }) // window starts at 3
    expect(log.replay('t:1', 2, log.epoch).kind).toBe('events') // oldest retained = 3 = 2 + 1
    expect(log.replay('t:1', 9, log.epoch)).toMatchObject({ kind: 'snapshot_required' }) // client ahead
    expect(log.replay('t:1', 4, 'other-epoch')).toMatchObject({ kind: 'snapshot_required' })
    expect(log.replay('t:1', -1).kind).toBe('snapshot_required')
    expect(new TopicLog({ epoch: 'e2' }).replay('t:none', 0, 'old')).toMatchObject({ kind: 'up_to_date' })
  })

  test('client tracker detects duplicates and gaps', () => {
    const tracker = new TopicSeqTracker()
    expect(tracker.accept({ topic: 't', seq: 2, epoch: 'e' })).toBe('gap')
    expect(tracker.accept({ topic: 't', seq: 1, epoch: 'e' })).toBe('apply')
    expect(tracker.accept({ topic: 't', seq: 1, epoch: 'e' })).toBe('duplicate')
    expect(tracker.accept({ topic: 't', seq: 3, epoch: 'e' })).toBe('gap')
    expect(tracker.position('t')).toEqual({ epoch: 'e', seq: 1 })
    tracker.reset('t', 'e', 3)
    expect(tracker.accept({ topic: 't', seq: 4, epoch: 'e' })).toBe('apply')
    expect(tracker.accept({ topic: 't', seq: 5, epoch: 'e2' })).toBe('gap')
  })
})

describe('event projection', () => {
  const base: DomainEvent = { eventId: 'e', workspaceId: 'w', type: 'task.task_adding', aggregateRevision: 3, payload: { secret: 'title' }, createdAt: 'now' }

  test('default projection: subject → entity topic, ids only', () => {
    const registry = new EventProjectionRegistry()
    expect(registry.project(base)).toEqual([])
    const out = registry.project({ ...base, subject: { kind: 'task', id: 't1' } })
    expect(out).toEqual([{ topic: 'entity:task:t1', type: 'entity.updated', payload: { ref: { kind: 'task', id: 't1' }, revision: 3, domainType: 'task.task_adding' } }])
    expect(JSON.stringify(out)).not.toContain('secret')
  })

  test('system.pinged projects to user:{actor}; invalid publications are dropped', () => {
    const registry = new EventProjectionRegistry()
    expect(registry.project({ ...base, type: 'system.pinged', actorId: 'p1', causationId: 'c1', payload: { nonce: 'n' } }))
      .toEqual([{ topic: 'user:p1', type: 'system.pinged', payload: { commandId: 'c1', nonce: 'n' } }])
    registry.register('demo.thing', () => [{ topic: 'bogus', type: 'x' }, { topic: 'channel:c', type: 'not.a.channel.event' }, { topic: 'channel:c', type: 'message.created' }])
    expect(registry.project({ ...base, type: 'demo.thing' })).toEqual([{ topic: 'channel:c', type: 'message.created' }])
  })
})
