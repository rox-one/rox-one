/**
 * Pure-helper coverage for the model-picker. The helpers are tiny but they
 * back both the desktop dropdown and the compact (drawer) selector — pinning
 * the behavior here so future refactors of the picker can't quietly diverge
 * the two surfaces.
 */

import { describe, test, expect } from 'bun:test'
import type { LlmConnection } from '@rox/shared/config/llm-connections'
import {
  formatTokenCount,
  groupConnectionsByProvider,
  getConnectionModelsForPicker,
  getRuntimeModelsForPicker,
  stripPiPrefixForDisplay,
} from '../model-picker-helpers'
import { ROX_VISIBLE_TERMS } from '@rox/shared/identity'
import type { StartupRuntimeSummary } from '@rox/shared/protocol'

describe('native workspace model catalog', () => {
  const summary: StartupRuntimeSummary = {
    kind: 'configuration-only', slug: 'rox', providerType: 'omp', isDefault: true,
    defaultModel: 'rox/r1-max', models: [{ id: 'rox/r1-max', name: 'Rox R1 Max' }],
  }
  test('uses only the configured public catalog and never another connection for a locked session', () => {
    expect(getRuntimeModelsForPicker(summary)).toEqual(summary.models!)
    expect(getRuntimeModelsForPicker(summary, 'rox')).toEqual(summary.models!)
    expect(getRuntimeModelsForPicker(summary, 'removed-connection')).toEqual([])
    expect(getRuntimeModelsForPicker({ ...summary, models: undefined })).toEqual([])
  })
})

// -----------------------------------------------------------------------------
// stripPiPrefixForDisplay
// -----------------------------------------------------------------------------

describe('stripPiPrefixForDisplay', () => {
  test('strips the "pi/" prefix when present', () => {
    expect(stripPiPrefixForDisplay('pi/claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('returns input unchanged when prefix is absent', () => {
    expect(stripPiPrefixForDisplay('claude-opus-4-7')).toBe('claude-opus-4-7')
  })

  test('does NOT strip "pi:" (legacy other-form prefix)', () => {
    // The prefix is "pi/" — the alternative "pi:" form is intentionally not
    // collapsed because some IDs use a colon for unrelated purposes.
    expect(stripPiPrefixForDisplay('pi:claude-opus-4-7')).toBe('pi:claude-opus-4-7')
  })

  test('only strips at the start, not mid-string', () => {
    expect(stripPiPrefixForDisplay('foo-pi/bar')).toBe('foo-pi/bar')
  })

  test('handles empty string', () => {
    expect(stripPiPrefixForDisplay('')).toBe('')
  })

  test('keeps the ROX catalog display name', () => {
    expect(stripPiPrefixForDisplay('ROX R1')).toBe('ROX R1')
    expect(stripPiPrefixForDisplay('ROX Explore')).toBe('ROX Explore')
  })
})

// -----------------------------------------------------------------------------
// formatTokenCount
// -----------------------------------------------------------------------------

describe('formatTokenCount', () => {
  test('renders zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0')
  })

  test('renders < 1k literally', () => {
    expect(formatTokenCount(42)).toBe('42')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('renders 1k..<10k with one decimal', () => {
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(9999)).toBe('10.0k')
  })

  test('renders ≥ 10k as whole-k', () => {
    expect(formatTokenCount(10_000)).toBe('10k')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(999_999)).toBe('1000k')
  })

  test('renders ≥ 1M with one decimal', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.0M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(12_345_678)).toBe('12.3M')
  })
})

// -----------------------------------------------------------------------------
// groupConnectionsByProvider
// -----------------------------------------------------------------------------

function conn(
  slug: string,
  providerType: LlmConnection['providerType'],
  extras: Partial<LlmConnection> = {},
): LlmConnection {
  return {
    slug,
    name: slug,
    providerType,
    authType: 'api_key',
    createdAt: 0,
    ...extras,
  }
}

describe('getConnectionModelsForPicker', () => {
  test('reduces a stale bundled Rox catalog to R1 Max', () => {
    const rox = conn('rox-kimi', 'omp', { models: ['rox/explore', 'rox/standard', 'rox/max', 'rox/vision', 'rox/fast'] })
    const models = getConnectionModelsForPicker(rox)
    expect(models.map((model) => typeof model === 'string' ? model : model.id)).toEqual(['rox/r1-max'])
    expect(typeof models[0] !== 'string' && models[0].name).toBe('Rox R1 Max')
  })

  test('reduces a legacy onboarding Rox catalog while leaving private omp catalogs intact', () => {
    const legacy = conn('omp-2', 'omp', { name: 'Rox', defaultModel: 'rox/standard', models: ['rox/standard', 'rox/max', 'rox/fast'] })
    expect(getConnectionModelsForPicker(legacy).map(model => typeof model === 'string' ? model : model.id)).toEqual(['rox/r1-max'])
    const custom = { ...legacy, models: ['rox/standard', 'private/model'] }
    expect(getConnectionModelsForPicker(custom)).toEqual(custom.models)
  })

  test('preserves added providers and custom OMP model catalogs', () => {
    const anthropic = conn('anthropic', 'anthropic', { models: ['claude-opus-4-8', 'claude-sonnet-5'] })
    const customOmp = conn('private-runtime', 'omp', { models: ['private/custom'] })
    expect(getConnectionModelsForPicker(anthropic)).toEqual(anthropic.models!)
    expect(getConnectionModelsForPicker(customOmp)).toEqual(customOmp.models!)
  })

  test('falls back to the active provider instead of advertising Claude on Rox', () => {
    const models = getConnectionModelsForPicker(conn('omp', 'omp'))
    expect(models.map(model => typeof model === 'string' ? model : model.id)).toEqual(['rox/r1-max'])
    expect(getConnectionModelsForPicker(conn('custom-messages', 'anthropic_compat'))).toEqual([])
    expect(getConnectionModelsForPicker(conn('custom-openai', 'pi_compat'))).toEqual([])
  })
})

describe('groupConnectionsByProvider', () => {
  test('returns empty array for empty input', () => {
    expect(groupConnectionsByProvider([])).toEqual([])
  })

  test('groups anthropic providers into "Anthropic"', () => {
    const a = conn('a', 'anthropic')
    const b = conn('b', 'anthropic')
    const result = groupConnectionsByProvider([a, b])
    expect(result).toEqual([['Anthropic', [a, b]]])
  })

  test('preserves intra-group order', () => {
    const a = conn('first', 'anthropic')
    const b = conn('second', 'anthropic')
    const c = conn('third', 'anthropic')
    const result = groupConnectionsByProvider([a, b, c])
    expect(result[0][1].map(c => c.slug)).toEqual(['first', 'second', 'third'])
  })

  test('places "Anthropic" group before pi groups (display order)', () => {
    const piConn = conn('pi-1', 'pi')
    const anth = conn('anthropic-1', 'anthropic')
    const result = groupConnectionsByProvider([piConn, anth])
    expect(result.map(([k]) => k)).toEqual(['Anthropic', 'Rox Backend'])
  })

  test('"pi_compat" with localhost baseUrl goes to "Local"', () => {
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://localhost:11434' })
    const result = groupConnectionsByProvider([local])
    expect(result).toEqual([['Local', [local]]])
  })

  test('"pi_compat" with remote baseUrl goes to "Rox Backend"', () => {
    const remote = conn('openrouter', 'pi_compat', { baseUrl: 'https://openrouter.ai/api/v1' })
    const result = groupConnectionsByProvider([remote])
    expect(result).toEqual([['Rox Backend', [remote]]])
  })

  test('drops empty groups from the output', () => {
    const a = conn('a', 'anthropic')
    const result = groupConnectionsByProvider([a])
    // Only "Anthropic" appears; "Local" and "Rox Backend" are dropped.
    expect(result.length).toBe(1)
    expect(result[0][0]).toBe('Anthropic')
  })

  test('full mixed input — anthropic + local + remote pi_compat + pi', () => {
    const anth = conn('a', 'anthropic')
    const local = conn('ollama', 'pi_compat', { baseUrl: 'http://127.0.0.1:1234' })
    const remote = conn('or', 'pi_compat', { baseUrl: 'https://openrouter.ai' })
    const pi = conn('p', 'pi')
    const result = groupConnectionsByProvider([anth, local, remote, pi])
    expect(result.map(([k, conns]) => [k, conns.map(c => c.slug)])).toEqual([
      ['Anthropic', ['a']],
      ['Local', ['ollama']],
      ['Rox Backend', ['or', 'p']],
    ])
  })

  test('places omp connections under the visible Rox product name, not OMP', () => {
    const omp = conn('rox-kimi', 'omp')
    const result = groupConnectionsByProvider([omp])
    expect(result).toEqual([[ROX_VISIBLE_TERMS.product, [omp]]])
    expect(result[0][0]).not.toBe('OMP')
  })

  test('keeps every configured provider reachable beside Rox', () => {
    const connections = [
      conn('rox-kimi', 'omp'),
      conn('direct-claude', 'anthropic'),
      conn('custom-messages', 'anthropic_compat', { models: ['private/message-model'] }),
      conn('pi-oauth', 'pi'),
      conn('local-openai', 'pi_compat', { baseUrl: 'http://localhost:11434' }),
      conn('remote-openai', 'pi_compat', { baseUrl: 'https://example.com' }),
    ]
    const grouped = groupConnectionsByProvider(connections)
    expect(grouped.flatMap(([, group]) => group).map(connection => connection.slug).sort())
      .toEqual(connections.map(connection => connection.slug).sort())
    expect(grouped.find(([name]) => name === 'Anthropic')?.[1].map(connection => connection.slug))
      .toEqual(['direct-claude', 'custom-messages'])
  })
})
