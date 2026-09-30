import { afterEach, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { createProject } from '../storage.ts';
import { loadProjectRoadmap, saveProjectRoadmap } from '../roadmap-storage.ts';
import { createRoadmapSaveQueue, emptyRoadmap, isRoadmapRevision, normalizeRoadmap } from '../roadmap.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Exercise the actual hook callback, not a duplicate of its implementation.
function actualCallback(environment: Record<string, unknown>, name: string): Function {
  const file = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/ProjectInfoPage.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callback) throw new Error(`Actual roadmap callback ${name} was not found`);
  const code = ts.transpileModule(`const actual = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return new Function(...Object.keys(environment), `${code}; return actual;`)(...Object.values(environment));
}

function actualFlush(environment: Record<string, unknown>): () => Promise<void> {
  return actualCallback(environment, 'flushSave') as () => Promise<void>;
}

function actualLoad(environment: Record<string, unknown>): () => () => void {
  const file = resolve(import.meta.dir, '../../../../../apps/electron/src/renderer/pages/ProjectInfoPage.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('getProjectRoadmap')) {
      callback = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callback) throw new Error('Actual roadmap load effect was not found');
  const code = ts.transpileModule(`const actual = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return new Function(...Object.keys(environment), `${code}; return actual;`)(...Object.values(environment));
}

it('actual settings save keeps the draft and never reports success after a rejected native update', async () => {
  const errors: string[] = [];
  const successes: string[] = [];
  const saving: boolean[] = [];
  const patches: unknown[] = [];
  const environment = {
    workspaceId: 'owned-workspace', project: { config: { slug: 'owned-project' } },
    editWorkingDir: ' /retained/path ', editDetails: ' retained details ', editColor: ' blue ',
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    window: { electronAPI: { updateProject: async (_workspace: string, _slug: string, patch: unknown) => {
      patches.push(patch);
      throw new Error('controlled update refusal');
    } } },
    toast: { error: (key: string) => errors.push(key), success: (key: string) => successes.push(key) },
    t: (key: string) => key, setSaving: (value: boolean) => saving.push(value),
  };
  const patchProject = actualCallback(environment, 'patchProject');
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await actualCallback({ ...environment, patchProject }, 'handleSaveSettings')();
    expect(patches).toEqual([{ workingDirectory: '/retained/path', details: 'retained details', color: 'blue' }]);
    expect(errors).toEqual(['projectInfo.saveFailed']);
    expect(successes).toEqual([]);
    expect(saving).toEqual([true, false]);
    expect([environment.editWorkingDir, environment.editDetails, environment.editColor])
      .toEqual([' /retained/path ', ' retained details ', ' blue ']);
    // Inline callers can safely ignore the refusal without an unhandled rejection.
    await expect(patchProject({ details: 'another retained edit' })).resolves.toBe(false);
  } finally { consoleError.mockRestore(); }
});

it('actual settings save reports success only after its native update receipt', async () => {
  let release!: () => void;
  const successes: string[] = [];
  const saving: boolean[] = [];
  const environment = {
    workspaceId: 'owned-workspace', project: { config: { slug: 'owned-project' } },
    editWorkingDir: '', editDetails: 'details', editColor: '',
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    window: { electronAPI: { updateProject: () => new Promise<void>(resolve => { release = resolve; }) } },
    toast: { error: () => {}, success: (key: string) => successes.push(key) },
    t: (key: string) => key, setSaving: (value: boolean) => saving.push(value),
  };
  const pending = actualCallback({ ...environment, patchProject: actualCallback(environment, 'patchProject') }, 'handleSaveSettings')();
  await Promise.resolve();
  expect(successes).toEqual([]);
  expect(saving).toEqual([true]);
  release();
  await pending;
  expect(successes).toEqual(['projectInfo.saved']);
  expect(saving).toEqual([true, false]);
});

it('actual settings save does not report success when native write authority is unavailable', async () => {
  let updates = 0;
  const successes: string[] = [];
  const environment = {
    workspaceId: 'owned-workspace', project: { config: { slug: 'owned-project' } },
    editWorkingDir: '', editDetails: 'retained details', editColor: '',
    soupProjectActResult: () => ({}), isClaimableLive: () => false,
    window: { electronAPI: { updateProject: async () => { updates++; } } },
    toast: { error: () => {}, success: (key: string) => successes.push(key) },
    t: (key: string) => key, setSaving: () => {},
  };
  await actualCallback({ ...environment, patchProject: actualCallback(environment, 'patchProject') }, 'handleSaveSettings')();
  expect(updates).toBe(0);
  expect(successes).toEqual([]);
  expect(environment.editDetails).toBe('retained details');
});

it('actual renderer autosave waits for each receipt, retains a newer draft and persists it using the acknowledged revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-roadmap-caller-'));
  roots.push(root);
  const { slug } = createProject(root, { name: 'Caller' });
  const initial = loadProjectRoadmap(root, slug).roadmap;
  const roadmapRef = { current: { ...initial, goal: 'A' } };
  const calls: unknown[] = [];
  const releases: (() => void)[] = [];
  const states: string[] = [];
  const save = async (_workspace: string, _slug: string, draft: unknown) => {
    calls.push(draft);
    const receipt = saveProjectRoadmap(root, slug, draft);
    await new Promise<void>((resolve) => releases.push(resolve));
    return receipt;
  };
  const environment = {
    normalizeRoadmap, saveTimer: { current: null }, workspaceId: 'owned-workspace', projectSlug: slug,
    roadmapRef, saveAttemptRef: { current: 0 },
    roadmapSaverRef: { current: createRoadmapSaveQueue(initial.revision!, (draft) => save('owned-workspace', slug, draft)) },
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    setSaveState: (state: string) => states.push(state), setRoadmapCorrupt: () => {}, setRoadmap: () => {},
    window: { electronAPI: { saveProjectRoadmap: save } }, toast: { error: () => {} }, t: (key: string) => key,
  };
  const flush = actualFlush(environment);
  const first = flush();
  await Promise.resolve();
  roadmapRef.current = { ...roadmapRef.current, goal: 'B' };
  const second = flush();
  await Promise.resolve();
  expect(calls).toHaveLength(1);
  expect(states).not.toContain('saved');
  releases[0]!();
  for (let i = 0; i < 8 && calls.length < 2; i++) await Promise.resolve();
  expect(roadmapRef.current.goal).toBe('B');
  expect(states.at(-1)).toBe('saving');
  releases[1]!();
  await Promise.all([first, second]);
  expect(loadProjectRoadmap(root, slug).roadmap.goal).toBe('B');
  expect(states.at(-1)).toBe('saved');
});

it('actual autosave keeps the draft after failure and ignores a late receipt after scope changes', async () => {
  const states: string[] = [];
  const errors: string[] = [];
  const draft = normalizeRoadmap({ goal: 'retained edit', revision: 'missing' });
  const roadmapRef = { current: draft };
  let release: (saved: ReturnType<typeof normalizeRoadmap>) => void = () => {};
  const saverRef = { current: createRoadmapSaveQueue('missing', async () => { throw new Error('controlled RPC refusal'); }) };
  const environment = {
    normalizeRoadmap, saveTimer: { current: null }, workspaceId: 'owned-workspace', projectSlug: 'owned-project',
    roadmapRef, roadmapSaverRef: saverRef, saveAttemptRef: { current: 0 },
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    setSaveState: (state: string) => states.push(state), setRoadmapCorrupt: () => {}, setRoadmap: () => {},
    toast: { error: (key: string) => errors.push(key) }, t: (key: string) => key,
  };
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const flush = actualFlush(environment);
    await flush();
    expect(roadmapRef.current).toBe(draft);
    expect(states.at(-1)).toBe('error');
    expect(errors).toEqual(['projectRoadmap.saveFailed']);
    saverRef.current = createRoadmapSaveQueue('missing', () => new Promise((resolve) => { release = resolve; }));
    const pending = flush();
    await Promise.resolve();
    // A new project owns the refs before the old project's delayed ACK arrives.
    saverRef.current = createRoadmapSaveQueue('missing', async () => normalizeRoadmap({ revision: 'b'.repeat(64) }));
    roadmapRef.current = normalizeRoadmap({ goal: 'new project edit' });
    const retainedStates = [...states];
    release(normalizeRoadmap({ goal: 'old project receipt', revision: 'a'.repeat(64) }));
    await pending;
    expect(roadmapRef.current.goal).toBe('new project edit');
    expect(states).toEqual(retainedStates);
  } finally { consoleError.mockRestore(); }
});

it('actual load effect clears an old project and does not arm autosave after a failed read', async () => {
  const roadmapRef = { current: normalizeRoadmap({ goal: 'old project private content' }) };
  const saverRef = { current: null };
  let saves = 0;
  const states: string[] = [];
  const environment = {
    emptyRoadmap, normalizeRoadmap, isRoadmapRevision, createRoadmapSaveQueue,
    roadmapRef, roadmapSaverRef: saverRef, saveTimer: { current: null }, saveAttemptRef: { current: 0 },
    SAVE_DEBOUNCE_MS: 400, flushRef: { current: () => {} },
    workspaceId: 'new-workspace', projectSlug: 'new-project',
    setSaveState: (state: string) => states.push(state), setRoadmap: () => {}, setRoadmapCorrupt: () => {}, setRoadmapLoaded: () => {},
    window: { electronAPI: { getProjectRoadmap: async () => null, saveProjectRoadmap: async () => { saves++; return emptyRoadmap(); } } },
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    toast: { error: () => {} }, t: (key: string) => key,
  };
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const cleanup = actualLoad(environment)();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(roadmapRef.current.goal).toBe('');
    expect(saverRef.current).toBeNull();
    expect(states.at(-1)).toBe('error');
    actualCallback(environment, 'updateRoadmap')((draft: ReturnType<typeof normalizeRoadmap>) => ({ ...draft, goal: 'retained new edit after failed read' }));
    await actualFlush(environment)();
    expect(roadmapRef.current.goal).toBe('retained new edit after failed read');
    expect(states.at(-1)).toBe('error');
    cleanup();
    expect(saves).toBe(0);
  } finally { consoleError.mockRestore(); }
});

it('queue does not advance its observed revision after a refusal or missing receipt', async () => {
  const revisions: (string | undefined)[] = [];
  let call = 0;
  const queue = createRoadmapSaveQueue('missing', async (draft) => {
    revisions.push(draft.revision);
    call++;
    if (call === 1) throw new Error('controlled refusal');
    if (call === 2) return emptyRoadmap();
    return normalizeRoadmap({ ...draft, revision: 'c'.repeat(64) });
  });
  await expect(queue.save(emptyRoadmap())).rejects.toThrow('controlled refusal');
  await expect(queue.save(emptyRoadmap())).rejects.toThrow('PROJECT_ROADMAP_MISSING_RECEIPT');
  await queue.save(emptyRoadmap());
  expect(revisions).toEqual(['missing', 'missing', 'missing']);
});

it('actual route cleanup flushes the pending draft through the captured old project scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rox-roadmap-route-'));
  roots.push(root);
  const first = createProject(root, { name: 'Old project' });
  const second = createProject(root, { name: 'New project' });
  const calls: string[] = [];
  const roadmapRef = { current: emptyRoadmap() };
  const saverRef = { current: null as ReturnType<typeof createRoadmapSaveQueue> | null };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const environment = {
    emptyRoadmap, normalizeRoadmap, isRoadmapRevision, createRoadmapSaveQueue,
    roadmapRef, roadmapSaverRef: saverRef, saveTimer: timerRef,
    workspaceId: 'old-workspace', projectSlug: first.slug,
    setSaveState: () => {}, setRoadmap: () => {}, setRoadmapCorrupt: () => {}, setRoadmapLoaded: () => {},
    soupProjectActResult: () => ({}), isClaimableLive: () => true,
    window: { electronAPI: {
      getProjectRoadmap: async (_workspace: string, slug: string) => loadProjectRoadmap(root, slug),
      saveProjectRoadmap: async (workspace: string, slug: string, draft: unknown) => {
        calls.push(`${workspace}/${slug}`);
        return saveProjectRoadmap(root, slug, draft);
      },
    } },
  };
  const cleanup = actualLoad(environment)();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  roadmapRef.current = { ...roadmapRef.current, goal: 'pending old project edit' };
  timerRef.current = setTimeout(() => { throw new Error('Cleanup must cancel debounce'); }, 5000);
  // The next render has a new scope; its effect has not begun until old cleanup.
  environment.workspaceId = 'new-workspace';
  environment.projectSlug = second.slug;
  cleanup();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(calls).toEqual([`old-workspace/${first.slug}`]);
  expect(loadProjectRoadmap(root, first.slug).roadmap.goal).toBe('pending old project edit');
  expect(loadProjectRoadmap(root, second.slug).exists).toBe(false);
  expect(saverRef.current).toBeNull();
  expect(timerRef.current).toBeNull();
});
