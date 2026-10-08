/**
 * Main-process `entities.links.v1` mirror: one IPC value must drive both the
 * shared deep-link parser and the server-core live flag source, so main and
 * renderer always agree.
 */
import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test'
import { ENTITIES_LINKS_WORKBENCH_FLAG } from '@rox/shared/feature-flags'
import { getEntitiesWorkbenchFlags, resetEntitiesWorkbenchFlags } from '@rox/server-core/entities/workbench-flags'
import { isEntityRoutesEnabled, resetEntityRoutesEnabled } from '../../shared/route-parser'
import { applyEntitiesLinksFlag, registerEntitiesLinksIpc } from '../entities-flags'

// deep-link.ts pulls the main logger (electron-log → electron binary), which
// this clone does not have installed. Stub the logger by absolute path so the
// pure parse logic stays testable here.
mock.module(new URL('../logger.ts', import.meta.url).pathname, () => ({
  mainLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))
const { parseDeepLink } = await import('../deep-link')

describe('main entities-links flag mirror', () => {
  const previous = process.env.CRAFT_FEATURE_ENTITIES_LINKS
  beforeEach(() => {
    delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    resetEntitiesWorkbenchFlags()
    resetEntityRoutesEnabled()
  })
  afterEach(() => {
    if (previous === undefined) delete process.env.CRAFT_FEATURE_ENTITIES_LINKS
    else process.env.CRAFT_FEATURE_ENTITIES_LINKS = previous
    resetEntitiesWorkbenchFlags()
    resetEntityRoutesEnabled()
  })

  it('defaults off and inert', () => {
    expect(isEntityRoutesEnabled()).toBe(false)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(false)
    expect(parseDeepLink('rox://goals/goal/g-1')).toBeNull()
  })

  it('applyEntitiesLinksFlag drives both consumers', () => {
    applyEntitiesLinksFlag(true)
    expect(isEntityRoutesEnabled()).toBe(true)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(true)
    expect(parseDeepLink('rox://goals/goal/g-1')?.view).toBe('goals/goal/g-1')
    applyEntitiesLinksFlag(false)
    expect(isEntityRoutesEnabled()).toBe(false)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(false)
    expect(parseDeepLink('rox://goals/goal/g-1')).toBeNull()
  })

  it('env override wins over the mirrored value', () => {
    applyEntitiesLinksFlag(false)
    process.env.CRAFT_FEATURE_ENTITIES_LINKS = '1'
    expect(isEntityRoutesEnabled()).toBe(true)
    expect(parseDeepLink('rox://docs/file/f-1')?.view).toBe('docs/file/f-1')
  })

  it('registers the renderer IPC channel', async () => {
    const channels = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerEntitiesLinksIpc({
      handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
        void channels.set(channel, listener)
      },
    } as unknown as import('electron').IpcMain)
    const handler = channels.get('entities:setLinksEnabled')
    expect(handler).toBeDefined()
    await handler!({}, true)
    expect(isEntityRoutesEnabled()).toBe(true)
    expect(getEntitiesWorkbenchFlags().has(ENTITIES_LINKS_WORKBENCH_FLAG)).toBe(true)
  })
})
