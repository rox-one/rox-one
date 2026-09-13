import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isClaimableLive } from '@craft-agent/core/rox2'
import {
  BROWSER_SURFACE_ID,
  NATIVE_RAIL_SURFACE_IDS,
  NATIVE_SURFACE_REQUIRES_CONATION_FLAG,
  bindNativeSurfaceEntity,
  kindForNativeSurface,
  nativeSurfaceListResult,
  nativeSurfaceResult,
} from '../rox2-native-surfaces.ts'

const ROOT = join(import.meta.dir, '../../../../../../')

function source(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const SURFACE_FILES: Record<string, readonly string[]> = {
  projects: [
    'apps/electron/src/renderer/pages/ProjectInfoPage.tsx',
    'packages/server-core/src/handlers/rpc/projects.ts',
  ],
  pages: [
    'packages/server-core/src/handlers/rpc/pages.ts',
    'apps/electron/src/renderer/components/pages/PagesHome.tsx',
  ],
  memory: [
    'packages/server-core/src/handlers/rpc/memory.ts',
    'packages/server-core/src/handlers/rpc/memory-proposals.ts',
  ],
  tasks: [
    'apps/electron/src/renderer/pages/TasksPage.tsx',
    'packages/server-core/src/handlers/rpc/tasks.ts',
  ],
  sources: [
    'apps/electron/src/renderer/pages/SourceInfoPage.tsx',
    'packages/server-core/src/handlers/rpc/sources.ts',
  ],
  skills: [
    'apps/electron/src/renderer/pages/SkillInfoPage.tsx',
    'packages/server-core/src/handlers/rpc/skills.ts',
  ],
  automations: [
    'apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx',
    'packages/server-core/src/handlers/rpc/automations.ts',
  ],
  connections: [
    'apps/electron/src/renderer/pages/ConnectionsPage.tsx',
    'packages/server-core/src/handlers/rpc/fabric.ts',
  ],
  browser: [
    'apps/electron/src/renderer/pages/BrowserPanelPage.tsx',
    'apps/electron/src/renderer/components/browser/WebBrowserPanel.tsx',
  ],
}

describe('ROX2 native rail and browser surfaces', () => {
  test('rail destinations stay reachable without Conation flags', () => {
    expect(NATIVE_SURFACE_REQUIRES_CONATION_FLAG).toBe(false)
    const nav = source('apps/electron/src/renderer/components/app-shell/nav-destinations.ts')
    expect(nav).toContain('NATIVE_SURFACE_REQUIRES_CONATION_FLAG')
    expect(NATIVE_SURFACE_REQUIRES_CONATION_FLAG).toBe(false)
    for (const id of NATIVE_RAIL_SURFACE_IDS) {
      expect(nav).toContain(`id: '${id}'`)
      expect(nav).toContain(`route: () => routes.view.${id}()`)
    }
  })

  test('native surface files have no conation.dev iframe', () => {
    for (const files of Object.values(SURFACE_FILES)) {
      for (const rel of files) {
        const text = source(rel)
        expect(text, rel).not.toContain('conation.dev')
        expect(text, rel).not.toMatch(/<iframe\b/i)
      }
    }
  })

  test('native binds and empty lists are live; fixture/conation are not', () => {
    for (const id of NATIVE_RAIL_SURFACE_IDS) {
      const entity = bindNativeSurfaceEntity(id, {
        id: 'item-1',
        title: id,
        workspaceId: 'ws-1',
        updatedAt: 1,
      })
      expect(entity.kind).toBe(kindForNativeSurface(id))
      expect(entity.source).toBe('native')
      expect(isClaimableLive(nativeSurfaceListResult(id, []))).toBe(false)
      expect(isClaimableLive(nativeSurfaceResult(id, 'native'))).toBe(false)
      expect(isClaimableLive(nativeSurfaceResult(id, 'fixture'))).toBe(false)
      expect(isClaimableLive(nativeSurfaceResult(id, 'conation'))).toBe(false)
    }
    expect(BROWSER_SURFACE_ID).toBe('browser')
    expect(isClaimableLive(nativeSurfaceResult('browser', 'native'))).toBe(false)
    expect(isClaimableLive(nativeSurfaceResult('browser', 'fixture'))).toBe(false)
    expect(isClaimableLive(nativeSurfaceResult('browser', 'conation'))).toBe(false)
  })

  test('connections binder does not claim Drive, Mail, or CRM live', () => {
    const text = source('apps/electron/src/renderer/pages/rox2-native-surfaces.ts')
    expect(text).toContain('Drive/Mail/CRM are not claimed live')
    expect(isClaimableLive(nativeSurfaceResult('connections', 'conation'))).toBe(false)
  })
})
