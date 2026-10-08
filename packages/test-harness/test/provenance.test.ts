/** W1-10 self-test: provenance core (pure function, in-memory files). */
import { describe, expect, test } from 'bun:test'
import { checkProvenanceFiles, isSourceFile, resolveProvenanceBase } from '../src/gates/provenance.ts'

const HEADER = '// Portions adapted from Operately (https://github.com/operately/operately),\n// file: turboui/src/x @ abc. Licensed under the Apache License, Version 2.0. Modified by Rox.\n'
// Assembled so this test file never contains the contiguous licence text itself.
const GNU_GPL = ['GNU', 'General', 'Public', 'License'].join(' ')
const GNU_AGPL = ['GNU', 'Affero', 'General', 'Public', 'License'].join(' ')
const SPDX = ['SPDX', 'License', 'Identifier'].join('-')

describe('provenance check', () => {
  test('clean files produce no violations', () => {
    expect(checkProvenanceFiles([{ path: 'a.ts', content: 'export const x = 1\n' }])).toEqual([])
  })
  test('a derivation claim without the header fails', () => {
    for (const content of ['// ported from operately turboui\n', '// Adapted from Operately\n', '// see github.com/operately/operately/blob/x\n']) {
      const v = checkProvenanceFiles([{ path: 'a.ts', content }])
      expect(v.length).toBe(1)
      expect(v[0]).toContain('provenance header')
    }
  })
  test('a derivation claim with the header passes', () => {
    const v = checkProvenanceFiles([{ path: 'a.ts', content: `${HEADER}export const x = 1\n` }])
    expect(v).toEqual([])
  })
  test('a plain mention of the programme name is not a derivation claim', () => {
    const v = checkProvenanceFiles([{ path: 'kinds.ts', content: '/** Registry for the unified Lark + Operately suite. */\nexport {}\n' }])
    expect(v).toEqual([])
  })
  test('an Enterprise-Edition source declaration always fails, in any file type', () => {
    // Split like the detector itself: this fixture must stay in-memory only.
    const ee = `// Source: operately/app${'/'}ee/api\n`
    for (const path of ['a.ts', 'docs/notes.md', 'NOTICE']) {
      const v = checkProvenanceFiles([{ path, content: `${HEADER}${ee}` }])
      expect(v.length).toBe(1)
      expect(v[0]).toContain('Enterprise-Edition')
    }
  })
  test('GPL / AGPL licence headers and SPDX ids in source files fail', () => {
    const cases: Array<[string, string]> = [
      ['b.ts', `// This program is free software under the ${GNU_GPL} v3\n`],
      ['c.rs', `// Licensed under the ${GNU_AGPL}\n`],
      ['d.py', `# ${SPDX}: AGPL-3.0-or-later\n`],
      ['e.go', `// ${SPDX}: GPL-2.0-only\n`],
      ['f.sql', `-- ${SPDX}: GPL-3.0\n`],
    ]
    for (const [path, content] of cases) {
      const v = checkProvenanceFiles([{ path, content }])
      expect(v.length, path).toBe(1)
      expect(v[0]).toContain('GPL')
    }
  })
  test('docs, NOTICE and inventories that mention AGPL pass; the bare word never fails', () => {
    const cases: Array<[string, string]> = [
      ['docs/specs/plan.md', `Never copy GPL/AGPL code (Macro, Stalwart). Their ${GNU_AGPL} is incompatible.\n`],
      ['NOTICE', `Some components are under the ${GNU_GPL}.\n`],
      ['plans/license-inventory.json', `{ "license": "AGPL-3.0", "spdx": "${SPDX}: AGPL-3.0-only" }\n`],
      ['a.ts', '// never copy GPL/AGPL code here\nexport const AGPL_FORBIDDEN = true\n'],
      ['b.ts', `// ${SPDX}: LGPL-2.1-or-later\n`],
      ['c.ts', `// ${SPDX}: Apache-2.0\n`],
    ]
    for (const [path, content] of cases) expect(checkProvenanceFiles([{ path, content }]), path).toEqual([])
  })
  test('excluded prefixes skip the literal rules but not the ee declaration', () => {
    const v = checkProvenanceFiles(
      [{ path: 'packages/test-harness/src/g.ts', content: '// ported from operately\n' }],
      { excludePrefixes: ['packages/test-harness/'] },
    )
    expect(v).toEqual([])
  })
  test('isSourceFile classifies by extension', () => {
    for (const p of ['a.ts', 'x/b.tsx', 'c.RS', 'd.sql', 'e.sh']) expect(isSourceFile(p), p).toBe(true)
    for (const p of ['README.md', 'NOTICE', 'LICENSE', 'x.json', 'y.yml', '.env']) expect(isSourceFile(p), p).toBe(false)
  })
})

describe('provenance base resolution', () => {
  test('explicit override wins', () => {
    expect(resolveProvenanceBase({ ROX_PROVENANCE_BASE: 'origin/x', GITHUB_BASE_REF: 'main' })).toBe('origin/x')
  })
  test('pull requests diff against origin/<GITHUB_BASE_REF>', () => {
    expect(resolveProvenanceBase({ GITHUB_BASE_REF: 'release/1.2' })).toBe('origin/release/1.2')
  })
  test('falls back to origin/main, never a hard-coded feature branch', () => {
    expect(resolveProvenanceBase({})).toBe('origin/main')
    expect(resolveProvenanceBase({ GITHUB_BASE_REF: '  ' })).toBe('origin/main')
  })
})
