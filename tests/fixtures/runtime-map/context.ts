/** Explicit typed test manifests; never installed into a production session. */
import { known, unknown, type RuntimeContextBlock, type RuntimeContextSnapshot } from '../../../packages/core/src/runtime-trace/types'

export const contextFixtureAgentIds = { child: 'context-child', missing: 'context-no-snapshot' } as const

export function createContextFixtureSnapshot(scope: 'root' | 'child'): RuntimeContextSnapshot {
  const blocks: RuntimeContextBlock[] = []
  const add = (kind: RuntimeContextBlock['kind'], count: number, name: string) => {
    for (let index = 1; index <= count; index++) blocks.push({
      id: `${scope}-${kind}-${index}`, kind, label: `${scope === 'root' ? 'Root' : 'Child'} ${name} ${index}`,
      source: `explicit-${scope}-context-fixture`, order: blocks.length, included: true, version: 'fixture-v1',
      content: { text: `${scope.toUpperCase()}_${kind.toUpperCase().replace('-', '_')}_${index}`, tokens: unknown() },
    })
  }
  if (scope === 'root') {
    add('system', 3, 'system'); add('rules', 3, 'rule'); add('memory', 2, 'memory')
    add('source', 6, 'source'); add('attachment', 2, 'attachment'); add('history', 2, 'history')
    add('tool-schema', 2, 'tool schema'); add('skill', 1, 'skill')
  } else {
    add('system', 1, 'restriction'); add('source', 1, 'source'); add('tool-schema', 1, 'read schema')
  }
  return {
    id: `fixture-${scope}-context-v1`, version: 1, capturedAt: known(1_200, 'explicit-context-fixture'),
    originalPrompt: { text: scope === 'root' ? 'Сравни два источника и проверь результат.' : 'Проверь отдельный дочерний контекст.' },
    effectivePrompt: { text: scope === 'root' ? 'ROOT_EFFECTIVE_PROMPT: Сравни два источника и проверь результат.' : 'CHILD_EFFECTIVE_PROMPT: Только чтение.' },
    model: { requested: `fixture/${scope}`, confirmed: known(`fixture/${scope}`, 'explicit fixture readback'), provider: 'fixture', contextWindow: known(scope === 'root' ? 32_768 : 16_384, 'explicit fixture model catalog') },
    blocks, inputTokens: unknown(), permissionMode: scope === 'root' ? 'ask' : 'read-only',
    coverage: { state: 'partial', source: 'runtime', missing: ['provider-serialized-payload', 'exact-input-tokenization'], reason: 'Explicit typed context fixture; no provider dispatch' },
  }
}
