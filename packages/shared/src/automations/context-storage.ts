import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionFilePath } from '../sessions/storage.ts';
import { readSessionHeader } from '../sessions/jsonl.ts';
import { atomicWriteFileSync } from '../utils/files.ts';
import { reconcileAutomationContext, sameAutomationContext, type AutomationContextResolution, type AutomationContextResolver } from './context.ts';
import type { AutomationContextReference, AutomationMatcher, AutomationGraph } from './types.ts';

/** Strict catalog reads distinguish absence from malformed or inaccessible storage.
 * The general UI loaders intentionally skip unreadable rows, which cannot prove deletion. */
function readCatalogEntity(root: string, directory: 'projects' | 'pages', filename: string, id: string): { id: string; projectId?: string } | null {
  const path = join(root, directory);
  try { if (!statSync(path).isDirectory()) throw new Error('Object catalog is unavailable'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const config = JSON.parse(readFileSync(join(path, entry.name, filename), 'utf8')) as { id?: unknown; projectId?: unknown };
    if (typeof config.id !== 'string' || (config.projectId !== undefined && typeof config.projectId !== 'string')) throw new Error('Object catalog is unavailable');
    if (config.id === id) return { id: config.id, projectId: config.projectId as string | undefined };
  }
  return null;
}

/** Missing external adapters are unavailable, never inferred deleted from a label. */
export function resolveLocalAutomationContextReference(root: string, workspaceId: string, reference: AutomationContextReference): AutomationContextResolution {
  if (reference.workspaceId !== workspaceId) return { status: 'available', workspaceId };
  try {
    if (!existsSync(root)) return { status: 'unavailable' };
    if (reference.projectId && !readCatalogEntity(root, 'projects', 'config.json', reference.projectId)) return { status: 'deleted' };
    if (!reference.object) return { status: 'available', workspaceId, projectId: reference.projectId };
    const { kind, id } = reference.object;
    if (/[\\/\0]/.test(id)) return { status: 'unavailable' };
    if (kind === 'page') {
      const page = readCatalogEntity(root, 'pages', 'page.json', id);
      return page ? { status: 'available', workspaceId, objectId: page.id, projectId: page.projectId } : { status: 'deleted' };
    }
    if (kind === 'session') {
      const path = getSessionFilePath(root, id);
      try { if (!statSync(path).isFile()) return { status: 'unavailable' }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'deleted' }; throw error; }
      const session = readSessionHeader(path);
      return session ? { status: 'available', workspaceId, objectId: session.id, projectId: session.projectId } : { status: 'unavailable' };
    }
    return { status: 'unavailable' };
  } catch { return { status: 'unavailable' }; }
}

interface StoredContextConfig { automations?: Record<string, AutomationMatcher[]>; automationGraph?: AutomationGraph; [key: string]: unknown }

function synchronizeGraphContexts(config: StoredContextConfig): void {
  const matchers = new Map(Object.values(config.automations ?? {}).flat().filter(matcher => matcher.id).map(matcher => [matcher.id, matcher]));
  for (const node of config.automationGraph?.nodes ?? []) {
    if (node.kind !== 'matcher' || !node.data.id) continue;
    const matcher = matchers.get(node.data.id);
    if (!matcher) continue;
    if (matcher.context) node.data.context = matcher.context;
    else delete node.data.context;
    if (matcher.contextPause) node.data.contextPause = matcher.contextPause;
    else delete node.data.contextPause;
  }
}

/** Persist only the observed canonical matcher's pause; never overwrite unrelated config edits. */
export function persistAutomationContextPause(path: string, matcher: AutomationMatcher): void {
  if (!matcher.id || !matcher.context || !matcher.contextPause || !existsSync(path)) return;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredContextConfig;
  const current = Object.values(raw.automations ?? {}).flat().find(candidate => candidate.id === matcher.id);
  if (!current || current.contextPause || !sameAutomationContext(current.context, matcher.context)) return;
  current.contextPause = matcher.contextPause;
  synchronizeGraphContexts(raw);
  atomicWriteFileSync(path, JSON.stringify(raw, null, 2) + '\n', { durable: true });
}

/** RPC/graph saves retain any pause latched while their async read was in flight.
 * Only IDs explicitly relinked by a validated user action may clear the latch. */
export function writeContextualAutomationsConfig(path: string, raw: unknown, workspaceId: string, resolve: AutomationContextResolver, relinkedIds: readonly string[] = []): void {
  const config = raw as StoredContextConfig;
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as StoredContextConfig : undefined;
  const previousById = new Map(Object.values(previous?.automations ?? {}).flat().map(matcher => [matcher.id, matcher]));
  for (const matchers of Object.values(config.automations ?? {})) {
    for (let index = 0; index < matchers.length; index++) {
      let matcher = matchers[index]!;
      const prior = previousById.get(matcher.id);
      if (prior?.contextPause && !relinkedIds.includes(matcher.id ?? '') && sameAutomationContext(prior.context, matcher.context)) {
        matcher = { ...matcher, contextPause: prior.contextPause };
      }
      if (matcher.context) {
        let resolved: AutomationContextResolution;
        try { resolved = resolve(matcher.context); } catch { resolved = { status: 'unavailable' }; }
        matcher = reconcileAutomationContext(matcher, workspaceId, resolved);
      }
      matchers[index] = matcher;
    }
  }
  synchronizeGraphContexts(config);
  atomicWriteFileSync(path, JSON.stringify(config, null, 2) + '\n', { durable: true });
}
