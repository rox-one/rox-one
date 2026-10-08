/**
 * Actual pinned native SDK parent -> task -> child -> task -> restricted worker
 * -> read/yield -> child/yield -> parent, and an actual eval agent() worker.
 * Provider is native in-memory mock.
 * Every fetch is forbidden; this does not prove remote/installed-app acceptance.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostRoxToolchainRoot } from '../lib/host-rox-toolchain.ts';
import { OMP_WORKER_POLICY_SOURCE } from '../../packages/shared/src/agent/omp-worker-policy.ts';
import { OmpRuntimeObserver, type OmpRuntimeObservation } from '../../packages/shared/src/agent/omp-runtime-observer.ts';
import { OmpRuntimeTraceBridge } from '../../packages/shared/src/agent/omp-runtime-trace-bridge.ts';
import type { RuntimeAgentObservation } from '../../packages/core/src/runtime-trace/types.ts';
import { writeWorkerEvidence } from './omp-worker-loop.ts';

async function main(): Promise<void> {
  const base = process.env.ROX_OMP_PACKAGE_DIR ?? join(hostRoxToolchainRoot(), 'omp', '18.4.12', 'package');
  if (JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).version !== '18.4.12') throw new Error('Expected pinned native OMP 18.4.12');
  const root = mkdtempSync(join(tmpdir(), 'rox-native-runtime-map-'));
  const outputPath = process.argv[2] ?? join(tmpdir(), 'rox-runtime-map-native-loop.json');
  const previousProfile = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'profile');
  let networkAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkAttempts++; throw new Error('Native fixture forbids network'); };
  const observations: RuntimeAgentObservation[] = [];
  const raw: OmpRuntimeObservation[] = [];
  const transportErrors: string[] = [];
  const bridge = new OmpRuntimeTraceBridge();
  bridge.beginRun('native-fixture-turn', 'NATIVE_PARENT_TASK');
  const observer = new OmpRuntimeObserver(join(root, 'observer'), event => { raw.push(event); observations.push(...bridge.map(event)); }, error => transportErrors.push(error.message));
  const previousObservationEnv = { path: process.env.ROX_RUNTIME_OBSERVATION_PATH, control: process.env.ROX_RUNTIME_CONTROL_PATH };
  Object.assign(process.env, observer.env);
  observer.beginRun('native-fixture-turn');
  let session: any;
  let auth: any;
  const requests: Array<{ kind: string; tools: string[]; reasoning: unknown; messages: unknown }> = [];
  const providerRequests: Array<{ model: { id: string; provider: string; contextWindow: number }; tools: string[] }> = [];
  const providerContexts: Array<{
    call: number; model: { id: string; provider: string }; tools: string[];
    boundary: 'native fixture provider Context';
    context: { sha256: string; byteLength: number };
    systemPrompt: { sha256: string; byteLength: number; parts: number };
    messages: { sha256: string; byteLength: number; count: number };
    toolSchemas: { sha256: string; byteLength: number; count: number };
    userTextParts: Array<{ sha256: string; byteLength: number; containsOriginalRootPrompt: boolean }>;
  }> = [];
  const contextComparisons: Array<{
    agentId: string; snapshotId: string; providerCall: number; effectivePromptSha256: string;
    effectivePromptByteLength: number; systemPromptSha256: string; systemPromptByteLength: number;
    actualProviderContextSha256: string; actualProviderContextByteLength: number;
    matchedFields: ['effectivePrompt:user-text-part', 'systemPrompt:ordered-parts'];
    matchesEffectivePromptPart: true; matchesSystemPromptParts: true;
    originalRootPromptDistinct?: true; originalRootPromptIncluded?: true;
  }> = [];
  const fingerprint = (value: string) => ({ sha256: createHash('sha256').update(value).digest('hex'), byteLength: Buffer.byteLength(value) });
  let taskResult: unknown;
  let evalResult: unknown;
  try {
    // Package-local paths are intentional: CI installs the native graph privately.
    const { Settings } = await import(base + '/src/config/settings.ts');
    const { AuthStorage } = await import(base + '/node_modules/@oh-my-pi/pi-ai/src/auth-storage.ts');
    const { ModelRegistry } = await import(base + '/src/config/model-registry.ts');
    const { createAgentSession } = await import(base + '/src/sdk.ts');
    const { initializeExtensions } = await import(base + '/src/modes/runtime-init.ts');
    const { SessionManager } = await import(base + '/src/session/session-manager.ts');
    const { loadExtensions } = await import(base + '/src/extensibility/extensions/loader.ts');
    const { EventBus } = await import(base + '/src/utils/event-bus.ts');
    const { createMockModel } = await import(base + '/node_modules/@oh-my-pi/pi-ai/src/providers/mock.ts');
    const { getSupportedEfforts } = await import(base + '/node_modules/@oh-my-pi/pi-catalog/src/model-thinking.ts');
    writeFileSync(join(root, 'worker-policy.js'), OMP_WORKER_POLICY_SOURCE, { mode: 0o600 });
    writeFileSync(join(root, 'fixture.txt'), 'NATIVE_READ_OK\n', { mode: 0o600 });
    const settings = Settings.isolated({
      'task.batch': false, 'task.enableEffort': true, 'task.maxEffort': 'max', 'task.maxRecursionDepth': 3,
      'task.isolation.enabled': false, 'async.enabled': false, 'eval.js': true, 'eval.py': false, 'eval.tools.enabled': true,
      'magicKeywords.enabled': true, 'magicKeywords.ultrathink': true, 'magicKeywords.orchestrate': true,
      'magicKeywords.workflow': true, 'providers.autoThinkingMaxEffort': 'max',
      disabledProviders: ['claude-plugins', 'agent-plugins', 'omp-plugins'],
      'modelRoles.default': 'fixture/worker', 'modelRoles.task': 'fixture/worker', 'modelRoles.smol': 'fixture/worker',
    });
    auth = await AuthStorage.create(join(root, 'auth.db'));
    const registry = new ModelRegistry(auth, join(root, 'models.yml'), { settings, cacheDbPath: join(root, 'cache.db') });
    let parentDispatched = false;
    let childDispatched = false;
    let grandchildRead = false;
    let evalDispatched = false;
    const handler = (context: any, options: any) => {
      const tools: string[] = context.tools?.map((tool: any) => tool.name) ?? [];
      const userMessages = context.messages.filter((message: any) => message.role === 'user');
      const isEvalWorker = JSON.stringify(userMessages).includes('NATIVE_EVAL_TASK');
      const kind = !tools.length ? 'task-label' : !tools.includes('yield') ? 'parent' : tools.includes('task') ? 'child' : isEvalWorker ? 'restricted-eval-child' : 'restricted-grandchild';
      requests.push({ kind, tools, reasoning: options?.reasoning, messages: structuredClone(context.messages) });
      if (kind === 'task-label') return { content: ['runtime-map-fixture'] };
      if (kind === 'parent' && !parentDispatched) {
        parentDispatched = true;
        return { content: [{ type: 'toolCall', id: 'actual-parent-task', name: 'task', arguments: { agent: 'fixture-worker', task: 'NATIVE_CHILD_TASK', effort: 'lo' } }] };
      }
      if (kind === 'child' && !childDispatched) {
        childDispatched = true;
        return { content: [{ type: 'toolCall', id: 'actual-child-task', name: 'task', arguments: { agent: 'fixture-restricted', task: 'NATIVE_GRANDCHILD_TASK', effort: 'lo' } }] };
      }
      if (kind === 'parent' && !evalDispatched) {
        evalDispatched = true;
        return { content: [{ type: 'toolCall', id: 'actual-parent-eval', name: 'eval', arguments: { language: 'js', timeout: 10,
          code: 'const runtimeEvalWorker = await agent("NATIVE_EVAL_TASK", { agent: "fixture-restricted", label: "eval-worker-fixture" }); print(await runtimeEvalWorker.wait());' } }] };
      }
      if (kind === 'restricted-eval-child') return { content: [{ type: 'toolCall', id: 'actual-eval-child-yield', name: 'yield', arguments: { data: { text: 'EVAL_OK' } } }] };
      if (kind === 'restricted-grandchild' && !grandchildRead) {
        grandchildRead = true;
        return { content: [{ type: 'thinking', thinking: 'Public fixture reasoning from native mock provider.' }, { type: 'toolCall', id: 'actual-grandchild-read', name: 'read', arguments: { path: join(root, 'fixture.txt') } }] };
      }
      if (kind === 'restricted-grandchild') return { content: [{ type: 'toolCall', id: 'actual-grandchild-yield', name: 'yield', arguments: { data: { text: 'GRANDCHILD_OK' } } }] };
      if (kind === 'child') return { content: [{ type: 'toolCall', id: 'actual-child-yield', name: 'yield', arguments: { data: { text: 'CHILD_OK' } } }] };
      return { content: ['PARENT_OK'] };
    };
    const mocks = new Map([
      ['worker', createMockModel({ id: 'worker', provider: 'fixture', reasoning: true, contextWindow: 200000, handler })],
      ['restricted', createMockModel({ id: 'restricted', provider: 'fixture', reasoning: true, contextWindow: 32768, handler })],
    ]);
    registry.registerProvider('fixture', { api: 'mock', baseUrl: 'mock://', apiKey: 'fixture-only',
      streamSimple: (model: any, context: any, options: unknown) => {
        providerRequests.push({ model: { id: model.id, provider: model.provider, contextWindow: model.contextWindow }, tools: context.tools?.map((tool: any) => tool.name) ?? [] });
        // This is the actual custom provider entry point after the native
        // convert/normalize/provider transforms. It is not an HTTP wire payload.
        // Persist hashes/lengths only; never duplicate private context content.
        const userTextParts: string[] = context.messages.filter((message: any) => message.role === 'user').flatMap((message: any) =>
          typeof message.content === 'string' ? [message.content] : Array.isArray(message.content)
            ? message.content.flatMap((part: any) => part.type === 'text' && typeof part.text === 'string' ? [part.text] : []) : []);
        if (providerContexts.length >= 32 || userTextParts.length > 128 || (context.systemPrompt?.length ?? 0) > 128) throw new Error('Native fixture provider Context evidence exceeded bounds');
        providerContexts.push({
          call: providerRequests.length, model: { id: model.id, provider: model.provider },
          tools: context.tools?.map((tool: any) => tool.name) ?? [], boundary: 'native fixture provider Context',
          context: fingerprint(JSON.stringify(context)),
          systemPrompt: { ...fingerprint(JSON.stringify(context.systemPrompt ?? [])), parts: context.systemPrompt?.length ?? 0 },
          messages: { ...fingerprint(JSON.stringify(context.messages)), count: context.messages.length },
          toolSchemas: { ...fingerprint(JSON.stringify(context.tools ?? [])), count: context.tools?.length ?? 0 },
          userTextParts: userTextParts.map(part => ({ ...fingerprint(part), containsOriginalRootPrompt: part.includes('NATIVE_PARENT_TASK') })),
        });
        const mock = mocks.get(model.id);
        if (!mock) throw new Error('Unexpected native fixture model route');
        return mock.stream(model, context, options);
      },
      models: [
        { id: 'worker', name: 'fixture worker', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 },
        { id: 'restricted', name: 'fixture restricted', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 2048 },
      ],
    });
    const supportedMaximum = getSupportedEfforts(registry.find('fixture', 'worker')).at(-1);
    // Preloaded ExtensionAPI instances retain their eventBus. The SDK must
    // receive that same native bus, as the CLI's early-loading path does.
    const eventBus = new EventBus();
    const extensions = await loadExtensions([join(root, 'worker-policy.js'), observer.extensionPath], root, eventBus);
    if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
    const result = await createAgentSession({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settings, authStorage: auth, modelRegistry: registry,
      model: registry.find('fixture', 'worker'), getApiKey: () => 'fixture-only', thinkingLevel: 'auto', toolNames: ['task', 'read', 'eval'],
      enableMCP: false, enableLsp: false, enableIrc: false, disableExtensionDiscovery: true, preloadedExtensions: extensions,
      eventBus,
      sessionManager: SessionManager.inMemory(root), skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
      systemPrompt: 'Fixture parent: dispatch exact native child and report its result.', autoApprove: true,
      inheritedSessionAgents: [
        { name: 'fixture-worker', description: 'nested worker', systemPrompt: 'Dispatch a restricted child and then yield.', tools: ['task', 'read'], spawns: ['fixture-restricted'], thinkingLevel: 'medium', model: ['fixture/worker:medium'], source: 'user' },
        { name: 'fixture-restricted', description: 'read-only grandchild', systemPrompt: 'Read the fixture and yield. No task/eval available.', tools: ['read'], thinkingLevel: 'medium', model: ['fixture/restricted:medium'], source: 'user' },
      ],
    });
    session = result.session;
    await initializeExtensions(session, { mode: 'rpc', reportRuntimeError: (error: unknown) => { throw new Error(JSON.stringify(error)); }, reportSendError: (_action: unknown, error: unknown) => { throw error; } });
    const events: any[] = [];
    session.subscribe((event: unknown) => events.push(event));
    await session.prompt('orchestrate workflowz ultrathink\n\nNATIVE_PARENT_TASK');
    observer.drain();
    taskResult = events.find(event => event.type === 'tool_execution_end' && event.toolName === 'task')?.result;
    evalResult = events.find(event => event.type === 'tool_execution_end' && event.toolName === 'eval')?.result;
    const childAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_CHILD_TASK'));
    const grandchildAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_GRANDCHILD_TASK'));
    const evalAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_EVAL_TASK'));
    if (childAssignment?.kind !== 'agent.assigned' || grandchildAssignment?.kind !== 'agent.assigned') throw new Error('Missing actual native two-level worker assignment observations');
    if (childAssignment.parentAgentId !== 'root' || grandchildAssignment.parentAgentId !== childAssignment.agentId) throw new Error('Actual native parent identities were not preserved');
    if (childAssignment.payload.assignment.nativeKind !== 'task' || grandchildAssignment.payload.assignment.nativeKind !== 'task') throw new Error('Actual task dispatch identities were not bound to native lifecycle ids');
    if (childAssignment.parentSpanId !== 'tool:actual-parent-task' || !grandchildAssignment.parentSpanId?.endsWith(':tool:actual-child-task')) throw new Error('Actual parent tool-call span identities were not preserved');
    if (evalAssignment?.kind !== 'agent.assigned' || evalAssignment.parentAgentId !== 'root' || evalAssignment.payload.assignment.nativeKind !== 'eval') throw new Error('Actual native eval worker delivery was not observed');
    const grandchildRequests = requests.filter(request => request.kind === 'restricted-grandchild');
    if (!grandchildRequests.length || grandchildRequests.some(request => JSON.stringify(request.tools) !== JSON.stringify(['read', 'yield']))) throw new Error('Actual restricted worker tools changed');
    const evalRequests = requests.filter(request => request.kind === 'restricted-eval-child');
    if (!evalRequests.length || evalRequests.some(request => JSON.stringify(request.tools) !== JSON.stringify(['read', 'yield']))) throw new Error('Actual eval worker restrictions changed');
    if (requests.filter(request => request.tools.length).some(request => request.reasoning !== supportedMaximum)) throw new Error('Actual native worker thinking policy changed');
    if (!observations.some(event => event.kind === 'tool.started' && event.toolUseId === 'actual-grandchild-read' && event.agentId === grandchildAssignment.agentId)) throw new Error('Actual nested native read was not observed');
    if (!observations.some(event => event.kind === 'reasoning.output' && event.agentId === grandchildAssignment.agentId && event.payload.provenance === 'provider')) throw new Error('Provided native mock reasoning was not observed');
    if (!observations.some(event => event.kind === 'agent.completed' && event.agentId === grandchildAssignment.agentId && event.payload.status === 'succeeded')) throw new Error('Native grandchild completion was not observed');
    if (!observations.some(event => event.kind === 'agent.completed' && event.agentId === evalAssignment.agentId && event.payload.status === 'succeeded')) throw new Error('Native eval worker completion was not observed');
    if (!observations.some(event => event.kind === 'agent.completed' && event.agentId === evalAssignment.agentId && event.payload.result?.text?.includes('EVAL_OK'))) throw new Error('Native eval worker yield result was not observed');
    if (!JSON.stringify(evalResult).includes('EVAL_OK')) throw new Error('Native parent did not receive eval worker yield');
    if (!JSON.stringify(taskResult).includes('CHILD_OK')) throw new Error('Native parent did not receive child yield');
    if (!observations.some(event => event.kind === 'context.captured' && event.agentId === 'root' && event.payload.snapshot.originalPrompt.text === 'NATIVE_PARENT_TASK')) throw new Error('Original root prompt was not preserved');
    if (!observations.some(event => event.kind === 'model.confirmed' && event.payload.model.confirmed.state === 'known' && event.payload.model.confirmed.value === 'fixture/worker')) throw new Error('Actual native model readback was not captured');
    for (const assignment of [grandchildAssignment, evalAssignment]) {
      if (!observations.some(event => event.kind === 'context.captured' && event.agentId === assignment.agentId && event.payload.snapshot.model.confirmed.state === 'known' && event.payload.snapshot.model.confirmed.value === 'fixture/restricted' && event.payload.snapshot.model.contextWindow.state === 'known' && event.payload.snapshot.model.contextWindow.value === 32768)) throw new Error('Actual restricted worker model/context readback was not captured');
    }
    if (!providerRequests.some(request => request.model.id === 'restricted' && request.model.contextWindow === 32768 && JSON.stringify(request.tools) === JSON.stringify(['read', 'yield']))) throw new Error('Actual restricted model did not receive the restricted native provider request');
    if (!providerRequests.some(request => request.model.id === 'worker' && request.model.contextWindow === 200000 && request.tools.includes('task'))) throw new Error('Actual parent/worker model route was not used');
    for (const agentId of ['root', childAssignment.agentId, grandchildAssignment.agentId, evalAssignment.agentId]) {
      // The native context hook includes keyword transformations applied after
      // before_agent_start. Compare that delivered effective prompt, not the
      // earlier preparation snapshot, to the actual provider request.
      const captured = observations.find(event => event.kind === 'context.changed' && event.agentId === agentId);
      if (captured?.kind !== 'context.changed' || captured.payload.snapshot.effectivePrompt.text === undefined) throw new Error('Native fixture Context comparison snapshot missing');
      const snapshot = captured.payload.snapshot;
      const effectivePrompt = fingerprint(snapshot.effectivePrompt.text!);
      const systemParts = snapshot.blocks.filter(block => block.kind === 'system').map(block => block.content.text);
      if (systemParts.some(part => part === undefined)) throw new Error('Native fixture system parts unavailable for comparison');
      const systemPrompt = fingerprint(JSON.stringify(systemParts));
      const confirmedModel = snapshot.model.confirmed.state === 'known' ? snapshot.model.confirmed.value : undefined;
      const actual = providerContexts.find(call => `${call.model.provider}/${call.model.id}` === confirmedModel
        && call.systemPrompt.sha256 === systemPrompt.sha256
        && call.userTextParts.some(part => part.sha256 === effectivePrompt.sha256 && part.byteLength === effectivePrompt.byteLength));
      if (!actual) throw new Error('Native effective prompt/system snapshot did not match actual fixture provider Context');
      const comparison: typeof contextComparisons[number] = { agentId, snapshotId: snapshot.id, providerCall: actual.call,
        effectivePromptSha256: effectivePrompt.sha256, effectivePromptByteLength: effectivePrompt.byteLength,
        systemPromptSha256: systemPrompt.sha256, systemPromptByteLength: systemPrompt.byteLength,
        actualProviderContextSha256: actual.context.sha256, actualProviderContextByteLength: actual.context.byteLength,
        matchedFields: ['effectivePrompt:user-text-part', 'systemPrompt:ordered-parts'],
        matchesEffectivePromptPart: true, matchesSystemPromptParts: true };
      if (agentId === 'root') {
        if (snapshot.originalPrompt.text !== 'NATIVE_PARENT_TASK' || fingerprint(snapshot.originalPrompt.text).sha256 === effectivePrompt.sha256
          || !actual.userTextParts.some(part => part.sha256 === effectivePrompt.sha256 && part.containsOriginalRootPrompt)) throw new Error('Original root prompt was not preserved distinctly inside actual provider Context');
        comparison.originalRootPromptDistinct = true;
        comparison.originalRootPromptIncluded = true;
      }
      contextComparisons.push(comparison);
    }
    if (observations.some(event => event.agentId === 'root' && ['tool.started', 'tool.completed', 'reasoning.output', 'usage.reported'].includes(event.kind))) throw new Error('Native root duplicated parent RPC events');
    if (transportErrors.length || networkAttempts) throw new Error('Observation transport/network error');
    writeWorkerEvidence(outputPath, {
      assertionsPassed: true, scope: 'Actual native SDK two-level task worker and eval-agent loops, fixture provider, private observer transport. No installed-app or remote provider claim.',
      ompVersion: '18.4.12', networkAttempts, paidProviderRequests: 0, supportedMaximum,
      requests: requests.map(({ kind, tools, reasoning }) => ({ kind, tools, reasoning })),
      rawHooks: raw.map(event => ({ hook: event.hook, agent: event.agent, nativeSessionId: event.nativeSessionId, sourceSeq: event.sourceSeq,
        dispatch: ['before_subagent_spawn', 'subagent_identity'].includes(event.hook) ? event.payload : undefined })),
      observations, taskResult, evalResult, providerRequests, providerContexts, contextComparisons,
      contextComparisonBoundary: { available: 'Actual native fixture provider Context after native transforms',
        unavailable: ['HTTP serialized request payload', 'exact provider tokenization'] },
    });
    console.log(JSON.stringify({ assertionsPassed: true, networkAttempts, requests: requests.map(({ kind, tools }) => ({ kind, tools })), observations: observations.length }));
  } catch (error) {
    writeWorkerEvidence(outputPath, {
      assertionsPassed: false, ompVersion: '18.4.12', networkAttempts, paidProviderRequests: 0,
      error: error instanceof Error ? error.message : String(error),
      requests: requests.map(({ kind, tools, reasoning }) => ({ kind, tools, reasoning })),
      observations, taskResult, evalResult, providerRequests, providerContexts, contextComparisons, transportErrors,
      contextComparisonBoundary: { available: 'Actual native fixture provider Context after native transforms',
        unavailable: ['HTTP serialized request payload', 'exact provider tokenization'] },
      rawHooks: raw.map(event => ({ hook: event.hook, agent: event.agent, nativeSessionId: event.nativeSessionId, sourceSeq: event.sourceSeq,
        dispatch: ['before_subagent_spawn', 'subagent_identity'].includes(event.hook) ? event.payload : undefined })),
      boundary: 'An unsuccessful native task loop is not acceptance evidence. Native file locks and integrity checks remain enabled.',
    });
    throw error;
  } finally {
    await session?.dispose(); auth?.close?.(); observer.dispose();
    globalThis.fetch = originalFetch;
    if (previousProfile === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousProfile;
    if (previousObservationEnv.path === undefined) delete process.env.ROX_RUNTIME_OBSERVATION_PATH; else process.env.ROX_RUNTIME_OBSERVATION_PATH = previousObservationEnv.path;
    if (previousObservationEnv.control === undefined) delete process.env.ROX_RUNTIME_CONTROL_PATH; else process.env.ROX_RUNTIME_CONTROL_PATH = previousObservationEnv.control;
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
