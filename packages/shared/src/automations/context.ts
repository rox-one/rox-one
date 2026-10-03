import type { AutomationContextReference, AutomationMatcher } from './types.ts';

export type AutomationContextResolution =
  | { status: 'available'; workspaceId: string; projectId?: string; objectId?: string }
  | { status: 'deleted' }
  | { status: 'unavailable' };
export type AutomationContextResolver = (reference: AutomationContextReference) => AutomationContextResolution;

export function sameAutomationContext(a?: AutomationContextReference, b?: AutomationContextReference): boolean {
  return a?.workspaceId === b?.workspaceId && a?.projectId === b?.projectId
    && a?.object?.kind === b?.object?.kind && a?.object?.id === b?.object?.id;
}

export function automationContextFailure(reference: AutomationContextReference, workspaceId: string, resolved: AutomationContextResolution): 'target-deleted' | 'target-out-of-scope' | null {
  if (reference.workspaceId !== workspaceId) return 'target-out-of-scope';
  if (resolved.status === 'deleted') return 'target-deleted';
  if (resolved.status === 'unavailable') return null;
  if (resolved.workspaceId !== reference.workspaceId
    || (reference.projectId !== undefined && resolved.projectId !== reference.projectId)
    || (reference.object && resolved.objectId !== reference.object.id)) return 'target-out-of-scope';
  return null;
}

export function reconcileAutomationContext(matcher: AutomationMatcher, workspaceId: string, resolved: AutomationContextResolution, now = new Date()): AutomationMatcher {
  if (!matcher.context || matcher.contextPause) return matcher;
  const reason = automationContextFailure(matcher.context, workspaceId, resolved);
  return reason ? { ...matcher, contextPause: { reason, detectedAt: now.toISOString() } } : matcher;
}

/** Association is display filtering, never a permission grant. */
export function automationsForContext(matchers: AutomationMatcher[], view: AutomationContextReference): AutomationMatcher[] {
  return matchers.filter(matcher => matcher.context && matcher.context.workspaceId === view.workspaceId
    && (view.projectId === undefined || matcher.context.projectId === view.projectId)
    && (!view.object || (matcher.context.object?.kind === view.object.kind && matcher.context.object.id === view.object.id)));
}

export function relinkAutomationContext(matcher: AutomationMatcher, reference: AutomationContextReference | undefined, workspaceId: string, resolved?: AutomationContextResolution): AutomationMatcher {
  if (reference && (!resolved || resolved.status !== 'available' || automationContextFailure(reference, workspaceId, resolved))) {
    throw new Error('Automation target is unavailable or outside its workspace/project');
  }
  const { contextPause: _pause, context: _previous, ...rest } = matcher;
  return { ...rest, ...(reference ? { context: reference } : {}) };
}

/** Scheduled rules use their resolved target; event rules require matching typed event context. */
export function automationMatchesEventContext(matcher: AutomationMatcher, event: string, payload: Record<string, unknown>): boolean {
  if (matcher.contextPause) return false;
  const reference = matcher.context;
  if (!reference) return true;
  if (payload.workspaceId !== undefined && payload.workspaceId !== reference.workspaceId) return false;
  if (event === 'SchedulerTick') return true;
  if (reference.projectId !== undefined && payload.projectId !== reference.projectId) return false;
  if (reference.object) {
    if (reference.object.kind === 'session') return payload.sessionId === reference.object.id;
    const object = payload.objectReference as { kind?: unknown; id?: unknown } | undefined;
    return object?.kind === reference.object.kind && object.id === reference.object.id;
  }
  return true;
}
