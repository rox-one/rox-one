import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import type { ModeContribution } from '@rox/core/platform'
import {
  DEFAULT_PILL_SURFACES,
  PILL_BROWSER_SURFACE_ID,
  __resetPillCompositionForTests,
  scenePillSurfaces,
  visiblePillSurfaces,
  type PillPreferences,
} from '../pill-composition'
import {
  SCENES_STORAGE_KEY,
  __resetScenesForTests,
  activateScene,
  activeScene,
  addScene,
  applyScene,
  clearScene,
  createScene,
  deleteScene,
  readScenesState,
  removeScene,
  renameScene,
  renameSceneIn,
  scenesSnapshot,
  type Scene,
  type ScenesState,
} from '../scenes'

const mode = (id: string, order: number, over: Partial<ModeContribution> = {}): ModeContribution => ({
  id,
  titleKey: `workbench.mode.${id}`,
  icon: 'Circle',
  rootRoute: `/${id}`,
  order,
  defaultPinned: true,
  layoutProfileId: 'agent',
  ...over,
})

const MODES: readonly ModeContribution[] = [
  mode('home', 10),
  mode('chat', 20),
  mode('meetings', 30),
  mode('tasks', 40),
  mode('notes', 50),
  mode('feed', 60),
  mode('inbox', 70),
]

const prefs = (over: Partial<PillPreferences> = {}): PillPreferences => ({
  pinned: [],
  excluded: [],
  usage: {},
  ...over,
})

beforeEach(() => {
  __resetScenesForTests()
  __resetPillCompositionForTests()
})

afterEach(() => {
  __resetScenesForTests()
  const globalWindow = globalThis as unknown as { window?: unknown }
  delete globalWindow.window
})

describe('scenes store', () => {
  it('creates a scene, trims the name, dedupes and keeps the surface order', () => {
    const scene = createScene('  Утро  ', ['feed', 'notes', 'feed', 'browser'])!
    expect(scene).toMatchObject({ name: 'Утро', surfaceIds: ['feed', 'notes', 'browser'] })
    expect(scenesSnapshot().scenes).toHaveLength(1)
    expect(scenesSnapshot().activeSceneId).toBe(scene.id)
  })

  it('refuses a blank name', () => {
    expect(createScene('   ', ['feed'])).toBeNull()
    expect(scenesSnapshot()).toEqual({ scenes: [], activeSceneId: null })
  })

  it('saving a scene activates it (priority composition)', () => {
    const a = createScene('A', ['feed'])
    const b = createScene('B', ['notes', 'feed'])!
    expect(scenesSnapshot().activeSceneId).toBe(b.id)
    expect(activeScene()?.id).toBe(b?.id)
    expect(activeScene()?.name).toBe('B')
    expect(a?.id).not.toBe(b?.id)
  })

  it('renames a scene and ignores blank renames', () => {
    const scene = createScene('Old', ['feed'])!
    renameScene(scene.id, 'New')
    expect(scenesSnapshot().scenes[0]?.name).toBe('New')
    renameScene(scene.id, '   ')
    expect(scenesSnapshot().scenes[0]?.name).toBe('New')
  })

  it('applies a known scene and falls back for unknown ids', () => {
    const scene = createScene('A', ['feed'])!
    clearScene()
    expect(scenesSnapshot().activeSceneId).toBeNull()
    applyScene(scene.id)
    expect(scenesSnapshot().activeSceneId).toBe(scene.id)
    applyScene('ghost')
    expect(scenesSnapshot().activeSceneId).toBeNull()
  })

  it('clearing keeps saved scenes but drops the active one', () => {
    createScene('A', ['feed'])
    clearScene()
    expect(scenesSnapshot().scenes).toHaveLength(1)
    expect(scenesSnapshot().activeSceneId).toBeNull()
    expect(activeScene()).toBeNull()
  })

  it('deleting the active scene clears the active id', () => {
    const scene = createScene('A', ['feed'])!
    createScene('B', ['notes'])
    applyScene(scene.id)
    deleteScene(scene.id)
    expect(scenesSnapshot().scenes.map((s) => s.name)).toEqual(['B'])
    expect(scenesSnapshot().activeSceneId).toBeNull()
  })
})

describe('scene reducers (pure)', () => {
  const state: ScenesState = {
    scenes: [
      { id: 'a', name: 'A', surfaceIds: ['feed'], createdAt: 1 },
      { id: 'b', name: 'B', surfaceIds: ['notes'], createdAt: 2 },
    ],
    activeSceneId: 'a',
  }

  it('addScene appends and activates', () => {
    const scene: Scene = { id: 'c', name: 'C', surfaceIds: ['tasks'], createdAt: 3 }
    expect(addScene(state, scene)).toEqual({ scenes: [...state.scenes, scene], activeSceneId: 'c' })
  })

  it('renameSceneIn replaces the name, blank is a no-op', () => {
    expect(renameSceneIn(state, 'a', ' A2 ').scenes[0]?.name).toBe('A2')
    expect(renameSceneIn(state, 'a', '')).toBe(state)
  })

  it('removeScene drops the scene and clears an active match only', () => {
    expect(removeScene(state, 'a').activeSceneId).toBeNull()
    expect(removeScene(state, 'b').activeSceneId).toBe('a')
    expect(removeScene(state, 'b').scenes.map((s) => s.id)).toEqual(['a'])
  })

  it('activateScene only honours known ids', () => {
    expect(activateScene(state, 'b').activeSceneId).toBe('b')
    expect(activateScene(state, 'ghost').activeSceneId).toBeNull()
    expect(activateScene(state, null).activeSceneId).toBeNull()
  })
})

describe('readScenesState validation', () => {
  function withStorage(raw: string, run: () => void): void {
    const globalWindow = globalThis as unknown as { window?: unknown }
    globalWindow.window = {
      localStorage: { getItem: (key: string) => (key === SCENES_STORAGE_KEY ? raw : null) },
    }
    try {
      run()
    } finally {
      delete globalWindow.window
    }
  }

  it('drops malformed scenes and an unknown active id', () => {
    withStorage(
      JSON.stringify({
        scenes: [
          { id: 'a', name: 'A', surfaceIds: ['feed', 2, 'feed'], createdAt: 5 },
          { id: '', name: 'bad' },
          { name: 'no-id', surfaceIds: ['x'] },
          null,
        ],
        activeSceneId: 'ghost',
      }),
      () => {
        const state = readScenesState()
        expect(state.scenes).toEqual([{ id: 'a', name: 'A', surfaceIds: ['feed'], createdAt: 5 }])
        expect(state.activeSceneId).toBeNull()
      },
    )
  })

  it('falls back to an empty state on corrupt JSON', () => {
    withStorage('{not json', () => {
      expect(readScenesState()).toEqual({ scenes: [], activeSceneId: null })
    })
  })
})

describe('scenePillSurfaces', () => {
  it('keeps the scene order, mapping catalog ids and bare mode ids', () => {
    const ids = scenePillSurfaces(DEFAULT_PILL_SURFACES, MODES, {
      surfaceIds: ['inbox', 'notes', PILL_BROWSER_SURFACE_ID],
    }).map((s) => s.id)
    expect(ids).toEqual(['inbox', 'notes', PILL_BROWSER_SURFACE_ID])
  })

  it('drops unavailable modes (missing, non-navigable or through a dead fallback)', () => {
    const modes = MODES.filter((m) => m.id !== 'chat').concat(mode('messenger', 25, { rootRoute: null }))
    const resolved = scenePillSurfaces(DEFAULT_PILL_SURFACES, modes, {
      surfaceIds: ['feed', 'team', 'ghost'],
    })
    // team → messenger is non-navigable and chat is gone; ghost is absent.
    expect(resolved.map((s) => s.id)).toEqual(['feed'])
  })

  it('dedupes repeated ids', () => {
    const ids = scenePillSurfaces(DEFAULT_PILL_SURFACES, MODES, { surfaceIds: ['feed', 'feed', 'notes'] }).map(
      (s) => s.id,
    )
    expect(ids).toEqual(['feed', 'notes'])
  })

  it('exposes panel specs with a null mode', () => {
    const resolved = scenePillSurfaces(DEFAULT_PILL_SURFACES, MODES, { surfaceIds: [PILL_BROWSER_SURFACE_ID] })
    expect(resolved).toEqual([
      { id: PILL_BROWSER_SURFACE_ID, kind: 'panel', titleKey: 'workbench.pill.browser', icon: 'Globe', mode: null },
    ])
  })
})

describe('visiblePillSurfaces with an active scene', () => {
  const scene: Pick<Scene, 'surfaceIds'> = { surfaceIds: ['notes', 'feed'] }

  it('scene composition wins over frequency and pins', () => {
    const ids = visiblePillSurfaces(MODES, prefs({ pinned: ['browser'], usage: { agent: 99, feed: 1 } }), scene).map(
      (s) => s.id,
    )
    expect(ids).toEqual(['notes', 'feed'])
  })

  it('without a scene the automatic composition is unchanged', () => {
    const ids = visiblePillSurfaces(MODES, prefs()).map((s) => s.id)
    expect(ids).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })

  it('an empty scene composition falls back to the automatic composition', () => {
    const ids = visiblePillSurfaces(MODES, prefs(), { surfaceIds: [] }).map((s) => s.id)
    expect(ids).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })

  it('clearScene returns to the automatic composition immediately', () => {
    const created = createScene('S', ['tasks', 'inbox'])!
    const withScene = visiblePillSurfaces(MODES, prefs(), activeScene()).map((s) => s.id)
    expect(withScene).toEqual(['tasks', 'inbox'])
    deleteScene(created.id)
    const after = visiblePillSurfaces(MODES, prefs(), activeScene()).map((s) => s.id)
    expect(after).toEqual(['feed', 'team', 'agent', 'notes', 'browser'])
  })
})