/**
 * Actual pinned native SDK parent -> task -> child -> task -> restricted worker
 * -> read/yield -> child/yield -> parent, and an actual eval agent() worker.
 * Provider is native in-memory mock.
 * Every fetch is forbidden; this does not prove remote/installed-app acceptance.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { OMP_WORKER_POLICY_SOURCE } from '../../packages/shared/src/agent/omp-worker-policy.ts';
import { OmpRuntimeObserver, type OmpRuntimeObservation } from '../../packages/shared/src/agent/omp-runtime-observer.ts';
import { OmpRuntimeTraceBridge } from '../../packages/shared/src/agent/omp-runtime-trace-bridge.ts';
import type { RuntimeAgentObservation } from '../../packages/core/src/runtime-trace/types.ts';
import { writeWorkerEvidence } from './omp-worker-loop.ts';

async function main(): Promise<void> {
  const base = process.env.ROX_OMP_PACKAGE_DIR ?? join(homedir(), '.rox/toolchain/omp/18.4.12/package');
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
  let taskResult: unknown;
  try {
    // Package-local paths are intentional: CI installs the native graph privately.
    const { Settings } = await import(base + '/src/config/settings.ts');
    const { AuthStorage } = await import(base + '/node_modules/@oh-my-pi/pi-ai/src/auth-storage.ts');
    const { ModelRegistry } = await import(base + '/src/config/model-registry.ts');
    const { createAgentSession } = await import(base + '/src/sdk.ts');
    const { initializeExtensions } = await import(base + '/src/modes/runtime-init.ts');
    const { SessionManager } = await import(base + '/src/session/session-manager.ts');
    const { loadExtensions } = await import(base + '/src/extensibility/extensions/loader.ts');
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
    const mock = createMockModel({ id: 'worker', provider: 'fixture', reasoning: true, handler: (context: any, options: any) => {
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
    } });
    registry.registerProvider('fixture', { api: 'mock', baseUrl: 'mock://', apiKey: 'fixture-only',
      streamSimple: (_model: unknown, context: unknown, options: unknown) => mock.stream(mock, context, options),
      models: [{ id: 'worker', name: 'fixture worker', reasoning: true, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
    });
    const supportedMaximum = getSupportedEfforts(registry.find('fixture', 'worker')).at(-1);
    const extensions = await loadExtensions([join(root, 'worker-policy.js'), observer.extensionPath], root);
    if (extensions.errors.length) throw new Error(JSON.stringify(extensions.errors));
    const result = await createAgentSession({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settings, authStorage: auth, modelRegistry: registry,
      model: registry.find('fixture', 'worker'), getApiKey: () => 'fixture-only', thinkingLevel: 'auto', toolNames: ['task', 'read', 'eval'],
      enableMCP: false, enableLsp: false, enableIrc: false, disableExtensionDiscovery: true, preloadedExtensions: extensions,
      sessionManager: SessionManager.inMemory(root), skills: [], rules: [], contextFiles: [], promptTemplates: [], slashCommands: [],
      systemPrompt: 'Fixture parent: dispatch exact native child and report its result.', autoApprove: true,
      inheritedSessionAgents: [
        { name: 'fixture-worker', description: 'nested worker', systemPrompt: 'Dispatch a restricted child and then yield.', tools: ['task', 'read'], spawns: ['fixture-restricted'], thinkingLevel: 'medium', model: ['fixture/worker:medium'], source: 'user' },
        { name: 'fixture-restricted', description: 'read-only grandchild', systemPrompt: 'Read the fixture and yield. No task/eval available.', tools: ['read'], thinkingLevel: 'medium', model: ['fixture/worker:medium'], source: 'user' },
      ],
    });
    session = result.session;
    await initializeExtensions(session, { mode: 'rpc', reportRuntimeError: (error: unknown) => { throw new Error(JSON.stringify(error)); }, reportSendError: (_action: unknown, error: unknown) => { throw error; } });
    const events: any[] = [];
    session.subscribe((event: unknown) => events.push(event));
    await session.prompt('orchestrate workflowz ultrathink\n\nNATIVE_PARENT_TASK');
    observer.drain();
    taskResult = events.find(event => event.type === 'tool_execution_end' && event.toolName === 'task')?.result;
    const childAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_CHILD_TASK'));
    const grandchildAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_GRANDCHILD_TASK'));
    const evalAssignment = observations.find(event => event.kind === 'agent.assigned' && event.payload.assignment.prompt.text?.includes('NATIVE_EVAL_TASK'));
    if (childAssignment?.kind !== 'agent.assigned' || grandchildAssignment?.kind !== 'agent.assigned') throw new Error('Missing actual native two-level worker assignment observations');
    if (childAssignment.parentAgentId !== 'root' || grandchildAssignment.parentAgentId !== childAssignment.agentId) throw new Error('Actual native parent identities were not preserved');
    if (evalAssignment?.kind !== 'agent.assigned' || evalAssignment.parentAgentId !== 'root' || evalAssignment.payload.assignment.nativeKind !== 'eval') throw new Error('Actual native eval worker delivery was not observed');
    const grandchildRequests = requests.filter(request => request.kind === 'restricted-grandchild');
    if (!grandchildRequests.length || grandchildRequests.some(request => JSON.stringify(request.tools) !== JSON.stringify(['read', 'yield']))) throw new Error('Actual restricted worker tools changed');
    const evalRequests = requests.filter(request => request.kind === 'restricted-eval-child');
    if (!evalRequests.length || evalRequests.some(request => JSON.stringify(request.tools) !== JSON.stringify(['read', 'yield']))) throw new Error('Actual eval worker restrictions changed');
    if (requests.filter(request => request.tools.length).some(request => request.reasoning !== supportedMaximum)) throw new Error('Actual native worker thinking policy changed');
    if (!observations.some(event => event.kind === 'tool.started' && event.toolUseId === 'actual-grandchild-read' && event.agentId === grandchildAssignment.agentId)) throw new Error('Actual nested native read was not observed');
    if (!observations.some(event => event.kind === 'reasoning.output' && event.agentId === grandchildAssignment.agentId && event.payload.provenance === 'provider')) throw new Error('Provided native mock reasoning was not observed');
    if (!observations.some(event => event.kind === 'agent.completed' && event.agentId === grandchildAssignment.agentId && event.payload.status === 'succeeded')) throw new Error('Native grandchild completion was not observed');
    if (!JSON.stringify(taskResult).includes('CHILD_OK')) throw new Error('Native parent did not receive child yield');
    if (!observations.some(event => event.kind === 'context.captured' && event.agentId === 'root' && event.payload.snapshot.originalPrompt.text === 'NATIVE_PARENT_TASK')) throw new Error('Original root prompt was not preserved');
    if (!observations.some(event => event.kind === 'model.confirmed' && event.payload.model.confirmed.state === 'known' && event.payload.model.confirmed.value === 'fixture/worker')) throw new Error('Actual native model readback was not captured');
    if (observations.some(event => event.agentId === 'root' && ['tool.started', 'tool.completed', 'reasoning.output', 'usage.reported'].includes(event.kind))) throw new Error('Native root duplicated parent RPC events');
    if (transportErrors.length || networkAttempts) throw new Error('Observation transport/network error');
    writeWorkerEvidence(outputPath, {
      assertionsPassed: true, scope: 'Actual native SDK two-level task worker and eval-agent loops, fixture provider, private observer transport. No installed-app or remote provider claim.',
      ompVersion: '18.4.12', networkAttempts, paidProviderRequests: 0, supportedMaximum,
      requests: requests.map(({ kind, tools, reasoning }) => ({ kind, tools, reasoning })),
      rawHooks: raw.map(event => ({ hook: event.hook, agent: event.agent, nativeSessionId: event.nativeSessionId, sourceSeq: event.sourceSeq })),
      observations, taskResult,
    });
    console.log(JSON.stringify({ assertionsPassed: true, networkAttempts, requests: requests.map(({ kind, tools }) => ({ kind, tools })), observations: observations.length }));
  } catch (error) {
    writeWorkerEvidence(outputPath, {
      assertionsPassed: false, ompVersion: '18.4.12', networkAttempts, paidProviderRequests: 0,
      error: error instanceof Error ? error.message : String(error),
      requests: requests.map(({ kind, tools, reasoning }) => ({ kind, tools, reasoning })),
      observations, taskResult, transportErrors,
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
