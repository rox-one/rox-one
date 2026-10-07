import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('inspector-resize browser fixture', () => {
  it('bootstraps harness session mode so InspectorHost renders resize sash', () => {
    const fixture = readFileSync(join(import.meta.dirname, 'fixtures/inspector-resize/main.tsx'), 'utf8')
    expect(fixture).toContain('featureWorkbenchHarnessInspectorV1Atom')
    expect(fixture).toContain('panelStackAtom')
    expect(fixture).toContain('routes.view.allSessions')
    expect(fixture).toContain('inspectorUserOpenedAtom, true')
    expect(fixture).not.toContain('@/shared/routes')
    expect(fixture).toContain('getSessionFiles')
  })
})
