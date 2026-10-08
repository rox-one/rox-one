import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutomationSystem } from './automation-system.ts';
import { automationsForContext, reconcileAutomationContext, relinkAutomationContext, type AutomationContextResolution } from './context.ts';
import { resolveLocalAutomationContextReference, writeContextualAutomationsConfig } from './context-storage.ts';
import { validateAutomationsConfig } from './validation.ts';
import { matcherMatches } from './utils.ts';
import type { AutomationMatcher } from './types.ts';

const roots: string[] = [];
const matcher = (): AutomationMatcher => ({ id: 'stable', name: 'Daily', cron: '* * * * *',
  context: { workspaceId: 'ws', projectId: 'project', object: { kind: 'task', id: 'task_stable' } },
  actions: [{ type: 'prompt', prompt: 'Review this task' }] });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('typed automation associations', () => {
  it('durably assigns a missing matcher ID before storing a context pause', async () => {
    const root = mkdtempSync(join(tmpdir(), 'automation-context-id-')); roots.push(root);
    const path = join(root, 'automations.json');
    const { id: _id, ...withoutId } = matcher();
    writeFileSync(path, JSON.stringify({ version: 2, automations: { SchedulerTick: [withoutId] } }));
    let system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => ({ status: 'deleted' }) });
    expect(system.getMatchersForEvent('SchedulerTick')).toEqual([]);
    const saved = JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick[0];
    expect(saved.id).toMatch(/^[0-9a-f]{6}$/);
    expect(saved.contextPause.reason).toBe('target-deleted');
    await system.dispose();
    system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => ({ status: 'available', workspaceId: 'ws', projectId: 'project', objectId: 'task_stable' }) });
    expect(system.getMatchersForEvent('SchedulerTick')).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick[0].id).toBe(saved.id);
    await system.dispose();
  });
  it('treats unreadable canonical data as unavailable and preserves IDs when an object is renamed', () => {
    const root = mkdtempSync(join(tmpdir(), 'automation-context-catalog-')); roots.push(root);
    mkdirSync(join(root, 'pages', 'before'), { recursive: true });
    const reference = { workspaceId: 'ws', object: { kind: 'page' as const, id: 'page_stable' } };
    writeFileSync(join(root, 'pages', 'before', 'page.json'), '{broken');
    expect(resolveLocalAutomationContextReference(root, 'ws', reference)).toEqual({ status: 'unavailable' });
    writeFileSync(join(root, 'pages', 'before', 'page.json'), JSON.stringify({ id: 'page_stable', name: 'Before' }));
    renameSync(join(root, 'pages', 'before'), join(root, 'pages', 'after'));
    expect(resolveLocalAutomationContextReference(root, 'ws', reference)).toMatchObject({ status: 'available', objectId: 'page_stable' });
    rmSync(join(root, 'pages', 'after'), { recursive: true });
    expect(resolveLocalAutomationContextReference(root, 'ws', reference)).toEqual({ status: 'deleted' });
    expect(resolveLocalAutomationContextReference(join(root, 'temporarily-unmounted'), 'ws', reference)).toEqual({ status: 'unavailable' });
  });

  it('propagates canonical project metadata to event matching instead of guessing from the title', async () => {
    const root = mkdtempSync(join(tmpdir(), 'automation-context-events-')); roots.push(root);
    writeFileSync(join(root, 'automations.json'), JSON.stringify({ version: 2, automations: { LabelAdd: [{ id: 'stable', context: { workspaceId: 'ws', projectId: 'project' }, actions: [{ type: 'prompt', prompt: 'Review' }] }] } }));
    const prompts: unknown[][] = [];
    const system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => ({ status: 'available', workspaceId: 'ws', projectId: 'project' }), onPromptsReady: values => { prompts.push(values); } });
    await system.updateSessionMetadata('session', { projectId: 'other', labels: ['not-matched'] });
    expect(prompts).toHaveLength(0);
    await system.updateSessionMetadata('session', { projectId: 'project', labels: ['not-matched', 'matched'] });
    expect(prompts).toHaveLength(1);
    await system.dispose();
  });
  it('selects by workspace/project/object identity rather than label or title', () => {
    const linked = matcher();
    const other = { ...matcher(), id: 'other', context: { workspaceId: 'elsewhere', projectId: 'project', object: { kind: 'task' as const, id: 'task_stable' } } };
    const unbound = { id: 'unbound', name: 'project task_stable', actions: linked.actions };
    expect(automationsForContext([linked, other, unbound], linked.context!)).toEqual([linked]);
    expect(automationsForContext([linked], { workspaceId: 'ws', object: { kind: 'page', id: 'task_stable' } })).toEqual([]);
  });

  it('retains renamed stable references and does not mistake temporary unavailability for deletion', () => {
    const current = matcher();
    const available = { status: 'available' as const, workspaceId: 'ws', projectId: 'project', objectId: 'task_stable' };
    expect(reconcileAutomationContext(current, 'ws', available)).toBe(current);
    expect(reconcileAutomationContext(current, 'ws', { status: 'unavailable' })).toBe(current);
    expect(reconcileAutomationContext(current, 'ws', { ...available, projectId: 'moved' }).contextPause?.reason).toBe('target-out-of-scope');
  });

  it('preserves a pause until explicit relink and validates the new destination', () => {
    const paused = reconcileAutomationContext(matcher(), 'ws', { status: 'deleted' });
    const available = { status: 'available' as const, workspaceId: 'ws', projectId: 'project', objectId: 'task_stable' };
    expect(reconcileAutomationContext(paused, 'ws', available)).toBe(paused);
    expect(matcherMatches(paused, 'SchedulerTick', { workspaceId: 'ws', timestamp: Date.now() })).toBe(false);
    expect(() => relinkAutomationContext(paused, paused.context, 'ws', { status: 'unavailable' })).toThrow();
    expect(relinkAutomationContext(paused, paused.context, 'ws', available).contextPause).toBeUndefined();
    expect(relinkAutomationContext(paused, undefined, 'ws').context).toBeUndefined();
  });

  it('validates typed references and pause metadata in saved configuration', () => {
    const config = { automations: { SchedulerTick: [matcher()] } };
    const valid = validateAutomationsConfig(config);
    expect(valid.valid).toBe(true);
    if (valid.valid) expect(valid.config.automations.SchedulerTick?.[0]?.context).toEqual(matcher().context);
    expect(validateAutomationsConfig({ automations: { SchedulerTick: [{ ...matcher(), context: { workspaceId: 'ws', object: { kind: 'guessed', id: 'task_stable' } } }] } }).valid).toBe(false);
  });

  it('blocks foreign event context and does not guess project association for a legacy payload', () => {
    const current = { ...matcher(), context: { workspaceId: 'ws', projectId: 'project' } };
    expect(matcherMatches(current, 'SessionStatusChange', { workspaceId: 'ws', projectId: 'project' })).toBe(true);
    expect(matcherMatches(current, 'SessionStatusChange', { workspaceId: 'foreign', projectId: 'project' })).toBe(false);
    expect(matcherMatches(current, 'SessionStatusChange', { workspaceId: 'ws' })).toBe(false);
  });

  it('persists a deleted target pause across restart, while unavailable adapter remains recoverable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'automation-context-'));
    roots.push(root);
    const path = join(root, 'automations.json');
    writeFileSync(path, JSON.stringify({ version: 2, automations: { SchedulerTick: [matcher()] } }));
    let resolution: AutomationContextResolution = { status: 'unavailable' };
    let system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => resolution });
    expect(system.getMatchersForEvent('SchedulerTick')).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick[0].contextPause).toBeUndefined();
    resolution = { status: 'available', workspaceId: 'ws', projectId: 'project', objectId: 'task_stable' };
    expect(system.getMatchersForEvent('SchedulerTick')).toHaveLength(1);
    const staleSave = JSON.parse(readFileSync(path, 'utf8'));
    resolution = { status: 'deleted' };
    expect(system.getMatchersForEvent('SchedulerTick')).toEqual([]);
    await system.dispose();
    resolution = { status: 'available', workspaceId: 'ws', projectId: 'project', objectId: 'task_stable' };
    staleSave.automations.SchedulerTick[0].name = 'Edited while pause was discovered';
    writeContextualAutomationsConfig(path, staleSave, 'ws', () => resolution);
    expect(JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick[0].contextPause.reason).toBe('target-deleted');
    system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => resolution });
    expect(system.getMatchersForEvent('SchedulerTick')).toEqual([]);
    await system.dispose();
    const relinked = relinkAutomationContext(JSON.parse(readFileSync(path, 'utf8')).automations.SchedulerTick[0], matcher().context, 'ws', resolution);
    writeContextualAutomationsConfig(path, { automations: { SchedulerTick: [relinked] } }, 'ws', () => resolution, ['stable']);
    system = new AutomationSystem({ workspaceRootPath: root, workspaceId: 'ws', resolveContextReference: () => resolution });
    expect(system.getMatchersForEvent('SchedulerTick')).toHaveLength(1);
    await system.dispose();
  });
});
