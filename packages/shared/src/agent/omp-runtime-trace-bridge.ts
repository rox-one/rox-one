import { createHash } from 'node:crypto';
import {
  known, unknown,
  type RuntimeAgentObservation, type RuntimeContextBlock, type RuntimeContextSnapshot,
  type RuntimeContent, type RuntimeEventKind, type RuntimeEventPayloads,
  type RuntimeModel, type RuntimeStatus, type RuntimeTask,
} from '@rox/core/runtime-trace';
import type { OmpRuntimeObservation } from './omp-runtime-observer.ts';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const json = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value) ?? '';
const content = (value: unknown, truncated = false): RuntimeContent => ({
  text: json(value), byteLength: Buffer.byteLength(json(value)), truncated,
  availability: 'available', tokens: unknown('not-emitted'), isDelta: false,
});
const resultText = (value: unknown): string => {
  const result = record(value);
  return Array.isArray(result.content)
    ? result.content.flatMap(block => record(block).type === 'text' ? [text(record(block).text) ?? ''] : []).join('\n')
    : '';
};

interface NativeAgentState {
  prompt: string;
  effectivePrompt: string;
  systemPrompt: string[];
  tools: string[];
  toolDefinitions?: unknown;
  version: number;
  turn: number;
  planVersion: number;
  reasoning: Map<number, string>;
  toolInputs: Map<string, Record<string, unknown>>;
  yielded?: unknown;
}

/** Projects observations of the pinned native extension into the frozen UI contract. */
export class OmpRuntimeTraceBridge {
  private sourceSequences = new Map<string, number>();
  private nativeSequences = new Map<string, number>();
  private agents = new Map<string, NativeAgentState>();
  private spawns = new Map<string, 'task' | 'eval'>();
  private parentSpans = new Map<string, string>();
  private nativeIdentities = new Map<string, Map<string, { kind: 'task' | 'eval'; parentSpanId?: string }>>();
  private runId = '';
  private originalPrompt = '';
  private selectedSkills = new Map<string, string>();

  beginRun(runId: string, originalPrompt: string, skills: ReadonlyMap<string, string> = new Map()): void {
    this.runId = runId;
    this.originalPrompt = originalPrompt;
    this.sourceSequences.clear();
    this.nativeSequences.clear();
    this.agents.clear();
    this.spawns.clear();
    this.parentSpans.clear();
    this.nativeIdentities.clear();
    this.selectedSkills = new Map([...skills].map(([slug, path]) => [path, slug]));
  }

  map(event: OmpRuntimeObservation): RuntimeAgentObservation[] {
    // A cancelled predecessor can still flush its file after another turn begins.
    if (!this.runId || event.runId !== this.runId) return [];
    const sourceId = `omp-native:${event.runId}:${event.nativeSessionId}:${event.sourceId}`;
    // Each native emitter writes synchronously with its own increasing sequence.
    // File notifications/replay must not create a second assignment/tool/result.
    const previousNativeSeq = this.nativeSequences.get(sourceId);
    if (event.sourceSeq <= (previousNativeSeq ?? 0)) return [];
    this.nativeSequences.set(sourceId, event.sourceSeq);
    const main = event.agent.kind === 'main';
    const agentId = main ? 'root' : event.agent.id;
    const parentAgentId = event.agent.parentId === 'Main' ? 'root' : event.agent.parentId;
    // Native buses may mirror a descendant lifecycle to several observers.
    // Match the actual child registry parent before consuming a bus binding.
    const identity = parentAgentId && this.nativeIdentities.get(agentId)?.get(parentAgentId);
    if (identity) {
      this.spawns.set(agentId, identity.kind);
      if (identity.parentSpanId) this.parentSpans.set(agentId, identity.parentSpanId);
    }
    const agentKey = `${event.nativeSessionId}:${event.agent.id}`;
    let state = this.agents.get(agentKey);
    if (!state) {
      state = { prompt: '', effectivePrompt: '', systemPrompt: [], tools: [], version: 0, turn: 0, planVersion: 0, reasoning: new Map(), toolInputs: new Map() };
      this.agents.set(agentKey, state);
    }
    const observations: RuntimeAgentObservation[] = [];
    const make = <K extends RuntimeEventKind>(kind: K, payload: RuntimeEventPayloads[K], spanId?: string): void => {
      const sourceSeq = (this.sourceSequences.get(sourceId) ?? 0) + 1;
      this.sourceSequences.set(sourceId, sourceSeq);
      observations.push({
        sourceEventId: `${event.id}:${kind}:${observations.length}`, sourceId, sourceSeq,
        agentId, parentAgentId, spanId, parentSpanId: this.parentSpans.get(agentId),
        providerTurnId: `${event.nativeSessionId}:turn:${state!.turn}`,
        occurredAt: known(event.observedAt, 'OMP native extension hook'),
        elapsedMs: event.elapsedMs, clockDomain: `omp-native:${event.sourceId}`, origin: 'observed', kind, payload,
      } as RuntimeAgentObservation);
    };
    const model: RuntimeModel = {
      confirmed: event.model ? known(`${event.model.provider}/${event.model.id}`, 'OMP ExtensionContext.model') : unknown('not-emitted'),
      provider: event.model?.provider,
      contextWindow: event.model?.contextWindow === undefined ? unknown('not-emitted') : known(event.model.contextWindow, 'OMP model catalog'),
    };
    const captured = (blocks: RuntimeContextBlock[], source: string, providerPayload = false): RuntimeContextSnapshot => {
      const usage = record(event.payload.contextUsage);
      const tokens = number(usage.tokens);
      return {
        id: `${event.nativeSessionId}:context:${++state!.version}`,
        version: state!.version, capturedAt: known(event.observedAt, source),
        originalPrompt: content(main ? this.originalPrompt : state!.prompt),
        effectivePrompt: content(state!.effectivePrompt, event.truncated), model, blocks,
        // OMP's ContextUsage explicitly documents `tokens` as an estimate.
        inputTokens: tokens === undefined ? unknown('not-emitted') : known(tokens, 'OMP estimated ContextUsage', 'estimated'),
        workingDirectory: event.cwd,
        coverage: {
          state: 'partial', source: 'runtime',
          missing: [...(providerPayload ? [] : ['provider-serialized-payload', 'native-provider-tool-normalization']),
            ...(!providerPayload && !schemasAvailable() ? ['native-tool-parameters'] : []),
            'exact-input-tokenization', ...(event.truncated ? ['bounded-native-content'] : [])],
          reason: providerPayload ? 'Observed provider payload; exact tokenization is not emitted' : 'Observed native hook projection; provider serialization can add or transform fields',
        },
      };
    };
    const block = (kind: RuntimeContextBlock['kind'], label: string, value: unknown, order: number, source: string): RuntimeContextBlock => ({
      id: `${event.id}:block:${order}`, kind, label, source, order, content: content(value, event.truncated),
      included: true, reduction: event.truncated ? 'truncated' : 'unknown',
    });
    const schemasAvailable = (): boolean => Array.isArray(state!.toolDefinitions)
      && state!.toolDefinitions.length === state!.tools.length
      && state!.toolDefinitions.every(tool => record(tool).parametersAvailability === 'available' && record(tool).parameters !== undefined);
    const toolsBlock = (): RuntimeContextBlock => block(schemasAvailable() ? 'tool-schema' : 'native',
      schemasAvailable() ? 'Native declared tool parameter schemas' : 'Native tool metadata; parameter schema unavailable',
      state!.toolDefinitions ?? state!.tools, state!.systemPrompt.length, 'OMP ExtensionAPI.getAllTools; privacy-filtered declared schema');

    if (event.truncated) {
      make('trace.coverage', { coverage: { state: 'partial', source: 'runtime', missing: ['bounded-native-content'], reason: 'Native event exceeded content capture bounds' } });
    }
    if (previousNativeSeq !== undefined && event.sourceSeq > previousNativeSeq + 1) {
      make('trace.coverage', { coverage: { state: 'partial', source: 'runtime', missing: ['native-source-gap'],
        reason: `Native emitter omitted source sequences ${previousNativeSeq + 1}–${event.sourceSeq - 1}` } });
    }
    switch (event.hook) {
      case 'subagent_identity': {
        const childId = text(event.payload.id);
        const kind = event.payload.invocationKind;
        const parentToolCallId = text(event.payload.parentToolCallId);
        if (childId && (kind === 'task' || kind === 'eval')) {
          const candidates = this.nativeIdentities.get(childId) ?? new Map();
          candidates.set(agentId, { kind, parentSpanId: parentToolCallId ? main ? `tool:${parentToolCallId}` : `native:${event.nativeSessionId}:tool:${parentToolCallId}` : undefined });
          this.nativeIdentities.set(childId, candidates);
        }
        break;
      }
      case 'before_subagent_spawn': {
        const kind = event.payload.invocationKind;
        const spawnKey = text(event.payload.spawnKey);
        if (spawnKey && (kind === 'task' || kind === 'eval')) this.spawns.set(spawnKey, kind);
        break;
      }
      case 'before_agent_start': {
        state.prompt = text(event.payload.prompt) ?? '';
        state.effectivePrompt = state.prompt;
        state.systemPrompt = Array.isArray(event.payload.systemPrompt) ? event.payload.systemPrompt.filter((part): part is string => typeof part === 'string') : [];
        state.tools = Array.isArray(event.payload.tools) ? event.payload.tools.filter((name): name is string => typeof name === 'string') : [];
        state.toolDefinitions = event.payload.toolDefinitions;
        const snapshot = captured([
          ...state.systemPrompt.map((part, i) => block('system', `Native system ${i + 1}`, part, i, 'OMP before_agent_start')),
          toolsBlock(),
          block('user', 'Delivered prompt', state.prompt, state.systemPrompt.length + 1, 'OMP before_agent_start'),
        ], 'OMP before_agent_start');
        if (!main) make('agent.assigned', { assignment: {
          agentId, parentAgentId, name: event.agent.name,
          task: content(state.prompt, event.truncated), prompt: content(state.prompt, event.truncated),
          model, contextSnapshotId: snapshot.id, tools: state.tools,
          nativeKind: this.spawns.get(event.agent.id) ?? 'unknown',
        } });
        make('model.confirmed', { model });
        make('context.captured', { snapshot });
        break;
      }
      case 'context': {
        if (Array.isArray(event.payload.tools)) state.tools = event.payload.tools.filter((name): name is string => typeof name === 'string');
        if (Array.isArray(event.payload.toolDefinitions)) state.toolDefinitions = event.payload.toolDefinitions;
        const messages = Array.isArray(event.payload.messages) ? event.payload.messages : [];
        const latestUser = [...messages].reverse().map(record).find(message => message.role === 'user');
        if (latestUser) {
          if (typeof latestUser.content === 'string') state.effectivePrompt = latestUser.content;
          else if (Array.isArray(latestUser.content)) state.effectivePrompt = latestUser.content.flatMap(part => record(part).type === 'text' && typeof record(part).text === 'string' ? [record(part).text] : []).join('\n');
        }
        const blocks = [
          ...state.systemPrompt.map((part, i) => block('system', `Native system ${i + 1}`, part, i, 'OMP before_agent_start')),
          toolsBlock(),
          ...messages.map((message, i) => {
            const role = record(message).role;
            return block(role === 'user' ? 'user' : 'history', typeof role === 'string' ? role : 'Native message', message,
              state!.systemPrompt.length + 1 + i, 'OMP context provider projection');
          }),
        ];
        make('context.changed', { snapshot: captured(blocks, 'OMP context') });
        break;
      }
      case 'before_provider_request':
        make('context.changed', { snapshot: captured([block('native', 'Serialized provider payload', event.payload.providerPayload, 0, 'OMP before_provider_request')], 'OMP before_provider_request', true) });
        break;
      case 'agent_start':
        if (!main) make('agent.started', { name: event.agent.name, status: 'running' });
        break;
      case 'agent_end': {
        if (main || event.payload.willContinue === true) break;
        const messages = Array.isArray(event.payload.messages) ? event.payload.messages : [];
        const final = [...messages].reverse().map(record).find(message => message.role === 'assistant');
        const failed = final?.stopReason === 'error';
        make('agent.completed', { status: failed ? 'failed' : final?.stopReason === 'aborted' ? 'cancelled' : 'succeeded',
          result: state.yielded === undefined ? final ? content(resultText(final), event.truncated) : undefined : content(state.yielded, event.truncated) });
        break;
      }
      case 'turn_start':
        state.turn += 1;
        break;
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end': {
        const toolUseId = text(event.payload.toolCallId);
        const toolName = text(event.payload.toolName) ?? 'tool';
        if (!toolUseId) break;
        const spanId = `native:${event.nativeSessionId}:tool:${toolUseId}`;
        const starting = event.hook === 'tool_execution_start';
        const ending = event.hook === 'tool_execution_end';
        const args = starting ? record(event.payload.args) : state.toolInputs.get(toolUseId) ?? record(event.payload.args);
        if (starting) state.toolInputs.set(toolUseId, args);
        const result = ending ? event.payload.result : event.payload.partialResult;
        const status: RuntimeStatus = ending ? event.payload.isError ? 'failed' : 'succeeded' : 'running';
        if (ending && toolName === 'yield' && !event.payload.isError && 'data' in args) state.yielded = args.data;
        if (ending && toolName.toLowerCase() === 'read' && !event.payload.isError && typeof args.path === 'string') {
          const slug = this.selectedSkills.get(args.path);
          if (slug) make('skill.loaded', { capability: { kind: 'skill', id: slug, scope: 'session', label: slug },
            content: content(resultText(result) || result, event.truncated) }, spanId);
        }
        if (!main) {
          make(starting ? 'tool.started' : ending ? 'tool.completed' : 'tool.output', {
            name: toolName, input: starting ? content(args, event.truncated) : undefined,
            result: starting ? undefined : content(resultText(result) || result, event.truncated), status,
          }, spanId);
          observations.at(-1)!.toolUseId = toolUseId;
          if (toolName.toLowerCase() === 'bash' && typeof args.command === 'string') {
            const details = record(record(result).details);
            const exitCode = number(details.exitCode);
            make(starting ? 'terminal.started' : ending ? 'terminal.completed' : 'terminal.output', {
              command: args.command, cwd: text(args.cwd) ?? event.cwd, status,
              // Native bash combines stdout/stderr in its model content. Keep
              // separate streams unknown unless the executor actually emits them.
              stdout: typeof details.stdout === 'string' ? content(details.stdout, event.truncated) : undefined,
              stderr: typeof details.stderr === 'string' ? content(details.stderr, event.truncated) : undefined,
              exitCode: exitCode === undefined ? unknown('not-emitted') : known(exitCode, 'OMP BashToolDetails.exitCode'),
            }, spanId);
            observations.at(-1)!.toolUseId = toolUseId;
          }
        }
        if (ending && toolName === 'todo' && !event.payload.isError) {
          const details = record(record(result).details);
          if (details.op !== 'view' && Array.isArray(details.phases)) {
            const tasks: RuntimeTask[] = [];
            for (const phase of details.phases) {
              const nativePhase = record(phase);
              if (typeof nativePhase.name !== 'string' || !Array.isArray(nativePhase.tasks)) continue;
              for (const value of nativePhase.tasks) {
                const nativeTask = record(value);
                if (typeof nativeTask.content !== 'string' || !['pending', 'in_progress', 'completed', 'abandoned', 'blocked'].includes(String(nativeTask.status))) continue;
                const status: RuntimeStatus = nativeTask.status === 'completed' ? 'succeeded' : nativeTask.status === 'in_progress' ? 'running' : nativeTask.status === 'blocked' ? 'blocked' : nativeTask.status === 'abandoned' ? 'cancelled' : 'queued';
                tasks.push({ id: `${event.nativeSessionId}:todo:${createHash('sha256').update(`${nativePhase.name}\0${nativeTask.content}`).digest('hex').slice(0, 24)}`,
                  title: nativeTask.content, description: nativeTask.blocker ? content(nativeTask.blocker) : undefined,
                  agentId, status, dependsOn: [], criteria: [], authorityRef: `omp:${event.nativeSessionId}:todo`,
                });
              }
            }
            const version = ++state.planVersion;
            make(version === 1 ? 'plan.published' : 'plan.revised', { plan: { id: `${event.nativeSessionId}:todo`, version, tasks } });
            for (const task of tasks) make('task.state-changed', { task });
          }
        }
        if (ending && toolName === 'task') {
          const details = record(record(result).details);
          // A native task can return isError=false while an individual worker
          // failed before its first lifecycle hook. Preserve that limitation.
          if (Array.isArray(details.results)) {
            const unobservedFailures = details.results.map(record).filter(item =>
              (typeof item.error === 'string' || (typeof item.exitCode === 'number' && item.exitCode !== 0))
              && typeof item.id === 'string' && ![...this.agents.keys()].some(key => key.endsWith(`:${item.id}`)));
            if (unobservedFailures.length) make('trace.coverage', { coverage: { state: 'partial', source: 'runtime', missing: ['worker-lifecycle-before-start'],
              reason: 'Native worker startup failed before its first observation hook' } });
          }
        }
        if (ending) state.toolInputs.delete(toolUseId);
        break;
      }
      case 'message_update': {
        if (main) break;
        const delta = record(event.payload.assistantMessageEvent);
        const index = number(delta.contentIndex) ?? 0;
        if (delta.type === 'thinking_delta' || delta.type === 'thinking_end') {
          const complete = delta.type === 'thinking_end';
          const previous = state.reasoning.get(index) ?? '';
          const next = complete ? text(delta.content) ?? previous : previous + (text(delta.delta) ?? '');
          state.reasoning.set(index, next.slice(0, 65536));
          make('reasoning.output', { content: content(state.reasoning.get(index), event.truncated || next.length > 65536), provenance: 'provider', complete }, `${event.nativeSessionId}:reasoning:${state.turn}:${index}`);
          if (complete) state.reasoning.delete(index);
        }
        break;
      }
      case 'message_end': {
        if (main) break;
        const message = record(event.payload.message);
        if (message.role !== 'assistant') break;
        const usage = record(message.usage);
        const callId = `${event.nativeSessionId}:provider:${text(message.responseId) ?? number(message.timestamp) ?? event.id}`;
        if (Object.keys(usage).length) {
          const measured = (name: string) => number(usage[name]) === undefined ? unknown('not-emitted') : known(number(usage[name])!, `OMP assistant.usage.${name}`);
          make('usage.reported', { usage: { providerCallId: callId, scope: 'self', source: 'OMP provider assistant message',
            inputTokens: measured('input'), outputTokens: measured('output'), cacheReadTokens: measured('cacheRead'), cacheWriteTokens: measured('cacheWrite'),
            cost: number(record(usage.cost).total) === undefined ? unknown('not-emitted') : known(number(record(usage.cost).total)!, 'OMP provider usage cost'), currency: 'USD', final: true,
          } });
          observations.at(-1)!.providerCallId = callId;
        }
        const output = resultText(message);
        if (output) make('result.published', { content: content(output, event.truncated) });
        break;
      }
      case 'auto_compaction_end':
        make('context.compacted', { summary: event.payload.errorMessage ? content(event.payload.errorMessage) : undefined });
        break;
      case 'retry_fallback_applied':
        // The pinned native recovery emits this only after model change and
        // provider-session reset. Use the actual hook context readback.
        make('model.changed', { model });
        make('decision.recorded', { content: content(event.payload, event.truncated), provenance: 'explicit' });
        break;
      case 'auto_retry_start':
      case 'auto_retry_end': {
        make(event.hook === 'auto_retry_start' ? 'attempt.started' : 'attempt.completed', {
          status: event.hook === 'auto_retry_start' ? 'running' : event.payload.success ? 'succeeded' : 'failed',
          description: text(event.payload.finalError) ?? text(event.payload.errorMessage),
        });
        observations.at(-1)!.attemptId = `${event.nativeSessionId}:retry:${number(event.payload.attempt) ?? event.id}`;
        break;
      }
      case 'tool_approval_requested':
      case 'tool_approval_resolved': {
        // Root permissions already travel through the host approval handler.
        if (main) break;
        const id = text(event.payload.toolCallId) ?? text(event.payload.id) ?? event.id;
        if (event.hook === 'tool_approval_requested') make('approval.requested', { id, kind: 'permission', description: text(event.payload.description) ?? text(event.payload.reason) ?? text(event.payload.toolName) ?? 'Native tool approval' });
        else if (typeof event.payload.approved === 'boolean') make('approval.resolved', { id, approved: event.payload.approved });
        break;
      }
    }
    return observations;
  }
}
