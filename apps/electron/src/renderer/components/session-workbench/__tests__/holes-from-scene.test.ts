import { describe, expect, test } from 'bun:test'
import type { SessionScene } from '@craft-agent/core/mindmap'
import { holesFromScene } from '../holes-from-scene'

function scene(partial: Partial<SessionScene> = {}): SessionScene {
  return {
    id: 'scn_u1',
    triggerMessageId: 'u1',
    triggerPreview: '',
    outcomePreview: '',
    assistantMessageIds: [],
    tools: [],
    parentSceneId: null,
    childSceneIds: [],
    orphaned: false,
    ...partial,
  }
}

describe('holesFromScene', () => {
  test('extracts city and user holes from trigger templates', () => {
    const holes = holesFromScene(
      scene({ triggerPreview: 'Go to {{city}} with $user' }),
    )
    expect(holes.map((h) => h.id)).toEqual(['city', 'user'])
    expect(holes.find((h) => h.id === 'city')?.prompt).toBe('{{city}}')
    expect(holes.find((h) => h.id === 'user')?.prompt).toBe('{{user}}')
  })

  test('outcome FOO=bar becomes a valued hole prompt', () => {
    const holes = holesFromScene(scene({ outcomePreview: 'FOO=bar' }))
    expect(holes).toEqual([
      { id: 'FOO', title: 'FOO', prompt: 'FOO=bar' },
    ])
  })

  test('empty previews yield no holes', () => {
    expect(holesFromScene(scene())).toEqual([])
  })
})
