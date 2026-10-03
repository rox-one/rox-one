import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

test('T-MEMORY-SAVE: production LessonStore persists exact scope across reopen; write failure emits no evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'product-tour-memory-'))
  try {
    const code = `
      const { LessonStore } = await import('./packages/server-core/src/memory/LessonStore.ts');
      const { deriveKnowledgeSignals } = await import('./apps/electron/src/renderer/features/product-tour/adapters/knowledge/index.ts');
      const { join } = await import('node:path');
      const { writeFileSync } = await import('node:fs');
      const root = process.env.ROX_CONFIG_DIR;
      const observation = { binding: { clientProfileId: 'profile', workspaceId: 'workspace', panelId: 'panel', runToken: 'run' }, operationToken: 'operation', at: 10 };
      const make = scope => ({ rule: 'private scoped rule', category: 'knowledge', ts: '2026-10-03T00:00:00Z', scope, owner: { issuer: 'issuer', subject: 'subject' }, source: { trigger: 'explicit' } });
      const workspacePath = join(root, 'workspace', 'lessons.jsonl');
      const globalPath = join(root, 'global', 'lessons.jsonl');
      const stored = new LessonStore(workspacePath, 'workspace').add(make('workspace'));
      const global = new LessonStore(globalPath, 'global').add(make('global'));
      const readback = new LessonStore(workspacePath, 'workspace').listForOwner(stored.owner);
      if (deriveKnowledgeSignals(observation, { kind: 'memory-saved', workspaceId: 'workspace', scope: 'workspace', lesson: stored, readback }, 20).length !== 1) throw Error('real persistence missing');
      if (deriveKnowledgeSignals(observation, { kind: 'memory-saved', workspaceId: 'workspace', scope: 'workspace', lesson: stored, readback: [global] }, 20).length) throw Error('wrong scope counted');
      const blocked = join(root, 'blocked'); writeFileSync(blocked, 'occupied');
      let failed = false, emitted = [];
      try {
        const lesson = new LessonStore(join(blocked, 'lessons.jsonl'), 'workspace').add(make('workspace'));
        emitted = deriveKnowledgeSignals(observation, { kind: 'memory-saved', workspaceId: 'workspace', scope: 'workspace', lesson, readback: [] }, 20);
      } catch { failed = true; }
      if (!failed || emitted.length) throw Error('failed write counted');
      console.log('actual memory persistence, scope and failure passed');
    `
    const child = Bun.spawn([process.execPath, '-e', code], {
      cwd: resolve(import.meta.dir, '../../../../../../../../..'),
      env: { ...process.env, ROX_CONFIG_DIR: dir, CRAFT_CONFIG_DIR: dir }, stdout: 'pipe', stderr: 'pipe',
    })
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: 'actual memory persistence, scope and failure passed\n', stderr: '' })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 15000)
