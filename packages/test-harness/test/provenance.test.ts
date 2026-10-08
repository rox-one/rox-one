/** W1-10 self-test: provenance core (pure function, in-memory files). */
import { describe, expect, test } from 'bun:test'
import { checkProvenanceFiles } from '../src/gates/provenance.ts'

const HEADER = '// Portions adapted from Operately (https://github.com/operately/operately),\n// file: turboui/src/x @ abc. Licensed under the Apache License, Version 2.0. Modified by Rox.\n'

describe('provenance check', () => {
  test('clean files produce no violations', () => {
    expect(checkProvenanceFiles([{ path: 'a.ts', content: 'export const x = 1\n' }])).toEqual([])
  })
  test('an Operately mention without the header fails', () => {
    const v = checkProvenanceFiles([{ path: 'a.ts', content: '// ported from operately turboui\n' }])
    expect(v.length).toBe(1)
    expect(v[0]).toContain('provenance header')
  })
  test('an Operately mention with the header passes', () => {
    const v = checkProvenanceFiles([{ path: 'a.ts', content: `${HEADER}export const x = 1\n` }])
    expect(v).toEqual([])
  })
  test('an app/ee source declaration always fails', () => {
    const v = checkProvenanceFiles([{ path: 'a.ts', content: `${HEADER}// Source: operately/app/ee/api\n` }])
    expect(v.length).toBe(1)
    expect(v[0]).toContain('app/ee')
  })
  test('a GPL marker fails', () => {
    const v = checkProvenanceFiles([{ path: 'b.ts', content: '// GNU General Public License v3\n' }])
    expect(v.length).toBe(1)
    expect(v[0]).toContain('GPL')
  })
  test('excluded prefixes skip the literal rules but not the ee declaration', () => {
    const v = checkProvenanceFiles(
      [{ path: 'packages/test-harness/src/g.ts', content: '// operately\n' }],
      { excludePrefixes: ['packages/test-harness/'] },
    )
    expect(v).toEqual([])
  })
})
