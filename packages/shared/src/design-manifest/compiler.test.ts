import { describe, expect, it } from 'bun:test'
import {
  compileDesignManifest,
  DesignManifestSchema,
  DesignManifestValidationError,
  serializeDesignManifest,
} from './index.ts'

const allowedComponentIds = ['ActivityFeed', 'MetricsGrid'] as const
const allowedThemePresetIds = ['rox-default'] as const
const compileOptions = { allowedComponentIds, allowedThemePresetIds }

const manifest = {
  version: 1,
  screen: { id: 'operations-dashboard', title: ' Центр управления ', route: 'operations' },
  theme: { preset: 'rox-default' },
  layout: { type: 'grid', columns: 12, rowHeight: 8, gap: 12 },
  modules: [
    {
      id: 'metrics', type: 'MetricsGrid', x: 4, y: 0, w: 8, h: 3,
      props: { filters: { selected: ['week'], order: 'desc' }, density: 'compact' },
    },
    { id: 'activity', type: 'ActivityFeed', x: 0, y: 0, w: 4, h: 6 },
  ],
}

function expectValidationFailure(action: () => unknown, expected: string) {
  expect(action).toThrow(DesignManifestValidationError)
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(DesignManifestValidationError)
    expect((error as DesignManifestValidationError).issues.join('\n')).toContain(expected)
  }
}

describe('Design Manifest Compiler', () => {
  it('validates and deterministically normalizes safe grid manifests', () => {
    const input = structuredClone(manifest)
    const compiled = compileDesignManifest(input, compileOptions)

    expect(compiled.screen.title).toBe('Центр управления')
    expect(compiled.theme.preset).toBe('rox-default')
    expect(compiled.modules.map((module) => module.id)).toEqual(['activity', 'metrics'])
    expect(Object.keys(compiled.modules[1]!.props)).toEqual(['density', 'filters'])
    expect(Object.keys((compiled.modules[1]!.props.filters as Record<string, unknown>))).toEqual(['order', 'selected'])
    expect(input).toEqual(manifest)
  })

  it('produces the same transport payload for equivalent module and prop order', () => {
    const reordered = {
      ...manifest,
      modules: [
        manifest.modules[1],
        {
          ...manifest.modules[0],
          props: { density: 'compact', filters: { order: 'desc', selected: ['week'] } },
        },
      ],
    }

    expect(serializeDesignManifest(manifest, compileOptions))
      .toBe(serializeDesignManifest(reordered, compileOptions))
  })

  it('rejects components outside the caller-owned registry', () => {
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], type: 'ArbitraryCode' }] }, compileOptions),
      'not in the allowed component registry',
    )
  })

  it('rejects themes outside the caller-owned preset registry', () => {
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, theme: { preset: 'untrusted-theme' } }, compileOptions),
      'not in the allowed theme preset registry',
    )
  })

  it('rejects duplicate module ids and grid overflows', () => {
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], id: 'same' }, { ...manifest.modules[1], id: 'same', x: 10 }] }, compileOptions),
      'duplicate module id',
    )
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], x: 5 }] }, compileOptions),
      'exceeds grid column bounds',
    )
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], y: 9_999, h: 2 }] }, compileOptions),
      'exceeds grid row bounds',
    )
  })

  it('rejects non-JSON props, unsafe keys, and unknown manifest fields', () => {
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], props: { render: () => null } }] }, compileOptions),
      'JSON-safe',
    )
    expectValidationFailure(
      () => compileDesignManifest({ ...manifest, modules: [{ ...manifest.modules[0], props: JSON.parse('{"__proto__":"blocked"}') }] }, compileOptions),
      'not allowed',
    )
    expect(DesignManifestSchema.safeParse({ ...manifest, executable: 'nope' }).success).toBe(false)
  })
})
