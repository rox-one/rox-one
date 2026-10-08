/** W1-10 self-test: provenance core (pure function, in-memory files). */
import { describe, expect, test } from 'bun:test'
import { checkProvenanceFiles, commentLines, eeDeclarations, isSourceFile, resolveProvenanceBase } from '../src/gates/provenance.ts'

const HEADER = '// Portions adapted from Operately (https://github.com/operately/operately),\n// file: turboui/src/x @ abc. Licensed under the Apache License, Version 2.0. Modified by Rox.\n'
// Assembled so this test file never contains the contiguous licence text itself.
const GNU_GPL = ['GNU', 'General', 'Public', 'License'].join(' ')
const GNU_AGPL = ['GNU', 'Affero', 'General', 'Public', 'License'].join(' ')
const SPDX = ['SPDX', 'License', 'Identifier'].join('-')
// The Enterprise-Edition directory, split like the detector: rule 2 has no
// exemptions, so this file must never contain the contiguous path.
const EE = `app${'/'}ee`

/** TECH-SPEC.md lines 450–454 as merged on main and in spec PR #1537 (verbatim apart from the EE split). */
const SPEC_1537 = [
  `| Operately product reference | **Operately** \`app/\` + \`turboui/\` | **Apache-2.0** | Port / adapt allowed with NOTICE (§6.1). **\`${EE}/**\` is EE-licensed: never copy, read or port** |`,
  '',
  '### 6.1 Operately licence boundary',
  `1. **Allowed sources:** \`operately/operately\` repo root \`LICENSE\` (Apache-2.0) areas, \`app/\` (excluding \`${EE}/**\`) and \`turboui/\`. Reuse means porting TSX components, status / progress / cadence logic, wording, activity names, email copy and MCP tool shapes.`,
  `2. **Forbidden:** anything under \`${EE}/**\` (Enterprise Edition License: admin API, billing, support sessions, beacon). There is no need to read it. A CI guard (\`scripts/check-provenance.ts\`) fails if any file declares \`Source: operately/${EE}\`.`,
].join('\n')

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
  test('an Enterprise-Edition declaration in a source-file comment fails, in every §6.1 form', () => {
    const forms = [
      `// Source: operately/${EE}/api\n`,
      `// Portions adapted from Operately (https://github.com/operately/operately),\n// file: ${EE}/lib/operately_ee/admin.ex @ abc123\n`,
      `/**\n * file: operately/${EE}/lib/billing.ex @ abc123\n */\n`,
      `// see https://github.com/operately/operately/blob/0a1b2c3/${EE}/lib/support.ex\n`,
      `# ported: github.com/operately/operately/tree/main/${EE}/assets\n`,
      `export const x = 1 // file: ${EE}/x.ex @ abc\n`,
    ]
    for (const [i, content] of forms.entries()) {
      const path = i === 4 ? 'tool.py' : 'a.ts'
      const v = checkProvenanceFiles([{ path, content: `${HEADER}${content}` }])
      expect(v, content).toHaveLength(1)
      expect(v[0]).toContain('Enterprise-Edition')
    }
  })
  test('the #1537 TECH-SPEC rule text (docs) passes: the EE rule applies to source files only', () => {
    for (const path of ['docs/specs/2026-10-08-lark-operately-unified/TECH-SPEC.md', 'docs/specs/2026-10-08-lark-operately-unified/UNIFIED-SPEC.md', 'NOTICE']) {
      expect(checkProvenanceFiles([{ path, content: SPEC_1537 }]), path).toEqual([])
    }
  })
  test('string literals and code are not declarations; only comment lines are', () => {
    const code = `const FORBIDDEN = 'Source: operately/${EE}'\nconst re = new RegExp("file: ${EE}/")\nconst url = "https://github.com/operately/operately/blob/x/${EE}/y"\n`
    expect(eeDeclarations(code)).toEqual([])
    expect(checkProvenanceFiles([{ path: 'detector.ts', content: `${HEADER}${code}` }])).toEqual([])
    expect(commentLines('const u = "https://example.com/x" // trailing\n/* a\n b */\nconst y = 2\n')).toEqual(['// trailing', '/* a', 'b */'])
    // A non-EE file: line and the allowed-tree prose do not trip it.
    expect(eeDeclarations('// file: turboui/src/StatusBadge.tsx @ abc123\n// app/ (excluding the EE tree)\n')).toEqual([])
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
  test('excluded fixture files skip rules 1 and 3 but never the EE declaration', () => {
    const fixture = 'packages/test-harness/test/provenance.test.ts'
    expect(checkProvenanceFiles([{ path: fixture, content: `// ported from operately\n// ${GNU_GPL}\n` }], { excludePrefixes: [fixture] })).toEqual([])
    const ee = checkProvenanceFiles([{ path: fixture, content: `// Source: operately/${EE}/x\n` }], { excludePrefixes: [fixture] })
    expect(ee).toHaveLength(1)
    // Exact-file exemptions: a sibling file in the same directory is checked.
    expect(checkProvenanceFiles([{ path: 'packages/test-harness/src/other.ts', content: '// ported from operately\n' }], { excludePrefixes: [fixture] })).toHaveLength(1)
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
