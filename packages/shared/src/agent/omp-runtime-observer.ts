import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, mkdirSync, openSync, readSync, renameSync,
  rmSync, watch, writeFileSync, type FSWatcher,
} from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** Actual native extension observation; these records never execute tools. */
export interface OmpRuntimeObservation {
  version: 1;
  id: string;
  sourceId: string;
  sourceSeq: number;
  observedAt: number;
  elapsedMs: number;
  runId: string;
  nativeSessionId: string;
  agent: { kind: 'main' | 'sub'; id: string; name: string; depth: number; parentId?: string };
  hook: string;
  model?: { provider: string; id: string; contextWindow?: number };
  cwd: string;
  thinkingLevel?: string;
  payload: Record<string, unknown>;
  truncated?: boolean;
}

export const OMP_OBSERVATION_MAX_FRAME_BYTES = 524_288;

/**
 * Standalone factory copied into the private managed profile. OMP rebinds it
 * for native task/eval/restricted workers; ctx.agent is the upstream identity,
 * rather than a label guessed from a tool result or generated answer.
 * Notification handlers deliberately return nothing and register no tools.
 */
export const OMP_RUNTIME_OBSERVER_SOURCE = String.raw`
import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const path = process.env.ROX_RUNTIME_OBSERVATION_PATH;
const controlPath = process.env.ROX_RUNTIME_CONTROL_PATH;
let spoolBytes = 0;
let emitterCount = 0;
const sensitive = /^(?:authorization|proxy.?authorization|cookie|set.?cookie|password|passwd|secret|client.?secret|api.?key|access.?token|refresh.?token|id.?token|private.?key|credential)$/i;
const knownSecrets = Object.entries(process.env).filter(([key, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) && value && value.length >= 8).map(([, value]) => value);
function sanitized(value, state, depth = 0, key = '') {
  if (sensitive.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    for (const secret of knownSecrets) value = value.split(secret).join('[REDACTED]');
    value = value.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
      .replace(/((?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[=:]\s*["']?)[^\s,;"']+/gi, '$1[REDACTED]')
      .replace(/((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n"']+/gi, '$1[REDACTED]')
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
      .replace(/([a-z][a-z0-9+.-]{0,20}:\/\/[^:\s/]{1,256}:)[^@\s/]{1,2048}@/gi, '$1[REDACTED]@');
    if (value.length > 32768) { state.truncated = true; value = value.slice(0, 32768); }
    state.chars += value.length;
    if (state.chars > 200000) { state.truncated = true; return '[CONTENT TRUNCATED]'; }
    return value;
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 12) { state.truncated = true; return '[DEPTH TRUNCATED]'; }
  if (Array.isArray(value)) {
    if (value.length > 200) state.truncated = true;
    return value.slice(0, 200).map(item => sanitized(item, state, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    let count = 0;
    for (const [name, item] of Object.entries(value)) {
      if (++count > 200) { state.truncated = true; break; }
      // Images/blob bytes are not duplicated into the observation journal.
      if ((name === 'data' && value.type === 'image') || name === 'apiKey') { result[name] = '[REDACTED]'; continue; }
      result[name] = sanitized(item, state, depth + 1, name);
    }
    return result;
  }
  return undefined;
}
export default function roxRuntimeObserver(pi) {
  if (!path || !controlPath) return;
  if (++emitterCount > 128) { process.stderr.write('ROX_RUNTIME_OBSERVER_ERROR emitter quota exceeded\n'); return; }
  let runId;
  const emitterId = randomUUID();
  const startedAt = performance.now();
  let sourceSeq = 0;
  let quotaReported = false;
  const write = (hook, payload, ctx) => {
    if (!runId) return;
    try {
    const state = { truncated: false, chars: 0 };
    const model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, contextWindow: ctx.model.contextWindow } : undefined;
    const record = sanitized({ version: 1, id: randomUUID(), sourceId: emitterId, sourceSeq: ++sourceSeq,
      observedAt: Date.now(), elapsedMs: performance.now() - startedAt, runId,
      nativeSessionId: ctx.sessionManager.getSessionId(), agent: ctx.agent, hook,
      model, cwd: ctx.cwd, thinkingLevel: pi.getThinkingLevel(),
      payload }, state);
    record.truncated = state.truncated || undefined;
    const line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > 524288) {
      record.payload = { omission: 'Native observation exceeded bounded frame size', sourceHook: hook };
      record.truncated = true;
    }
    const output = JSON.stringify(record) + '\n';
    if (spoolBytes + Buffer.byteLength(output) > 67108864) {
      if (!quotaReported) { quotaReported = true; process.stderr.write('ROX_RUNTIME_OBSERVER_ERROR spool quota exceeded\n'); }
      return;
    }
    try { appendFileSync(path, output, { mode: 0o600 }); spoolBytes += Buffer.byteLength(output); }
    catch { process.stderr.write('ROX_RUNTIME_OBSERVER_ERROR cannot append observations\n'); }
    } catch { process.stderr.write('ROX_RUNTIME_OBSERVER_ERROR cannot capture observations\n'); }
  };
  pi.on('before_agent_start', (event, ctx) => {
    let control;
    try { control = JSON.parse(readFileSync(controlPath, 'utf8')); }
    catch { process.stderr.write('ROX_RUNTIME_OBSERVER_ERROR cannot read observation control\n'); return; }
    if (typeof control.runId !== 'string' || !control.runId) return;
    runId = control.runId;
    write('before_agent_start', { prompt: event.prompt, systemPrompt: event.systemPrompt,
      images: event.images?.map(image => ({ type: image.type, mimeType: image.mimeType })),
      tools: pi.getActiveTools(), toolDefinitions: pi.getAllTools(),
      contextUsage: ctx.getContextUsage() }, ctx);
  });
  pi.on('context', (event, ctx) => write('context', { messages: event.messages, contextUsage: ctx.getContextUsage() }, ctx));
  pi.on('before_provider_request', (event, ctx) => write('before_provider_request', { providerPayload: event.payload }, ctx));
  pi.on('before_subagent_spawn', (event, ctx) => write('before_subagent_spawn', event, ctx));
  for (const hook of ['agent_start', 'agent_end', 'turn_start', 'turn_end', 'tool_call',
    'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
    'auto_compaction_start', 'auto_compaction_end', 'auto_retry_start', 'auto_retry_end',
    'retry_fallback_applied', 'retry_fallback_succeeded', 'todo_reminder', 'goal_updated',
    'tool_approval_requested', 'tool_approval_resolved']) {
    pi.on(hook, (event, ctx) => write(hook, event, ctx));
  }
  pi.on('message_update', (event, ctx) => {
    const delta = event.assistantMessageEvent;
    // Preserve only the supplied public text/reasoning stream; no inferred thoughts.
    if (delta && ['text_delta', 'text_end', 'thinking_delta', 'thinking_end'].includes(delta.type))
      write('message_update', { assistantMessageEvent: delta }, ctx);
  });
  pi.on('message_end', (event, ctx) => write('message_end', { message: event.message }, ctx));
}
`;

/** Per-child private spool. A filesystem notification only transports real hooks. */
export class OmpRuntimeObserver {
  readonly extensionPath: string;
  readonly env: Record<string, string>;
  private readonly path: string;
  private readonly controlPath: string;
  private readonly fd: number;
  private watcher: FSWatcher | undefined;
  private offset = 0;
  private pending = '';
  private decoder = new StringDecoder('utf8');
  private disposed = false;

  constructor(
    private readonly directory: string,
    private readonly onObservation: (event: OmpRuntimeObservation) => void,
    private readonly onError: (error: Error) => void,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.extensionPath = join(directory, 'rox-runtime-observer.js');
    this.path = join(directory, 'native-observations.jsonl');
    this.controlPath = join(directory, 'native-observation-control.json');
    writeFileSync(this.extensionPath, OMP_RUNTIME_OBSERVER_SOURCE, { mode: 0o600, flag: 'wx' });
    writeFileSync(this.controlPath, JSON.stringify({ runId: '' }), { mode: 0o600, flag: 'wx' });
    this.fd = openSync(this.path, constants.O_CREAT | constants.O_EXCL | constants.O_RDONLY, 0o600);
    this.env = { ROX_RUNTIME_OBSERVATION_PATH: this.path, ROX_RUNTIME_CONTROL_PATH: this.controlPath };
    try {
      this.watcher = watch(directory, (_event, filename) => {
        if (filename?.toString() === 'native-observations.jsonl') this.drain();
      });
      this.watcher.unref();
    } catch (error) {
      // The OMP transport drains before each RPC frame and before completion too.
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  beginRun(runId: string): void {
    const nextPath = join(this.directory, `control-${randomUUID()}.pending`);
    writeFileSync(nextPath, JSON.stringify({ runId }), { mode: 0o600, flag: 'wx' });
    try { renameSync(nextPath, this.controlPath); }
    finally { rmSync(nextPath, { force: true }); }
  }

  drain(): void {
    if (this.disposed) return;
    try {
      const size = fstatSync(this.fd).size;
      if (size < this.offset) throw new Error('Native observation spool was truncated');
      const buffer = Buffer.alloc(65536);
      while (this.offset < size) {
        const count = readSync(this.fd, buffer, 0, Math.min(buffer.length, size - this.offset), this.offset);
        if (!count) break;
        this.offset += count;
        this.pending += this.decoder.write(buffer.subarray(0, count));
        let index: number;
        while ((index = this.pending.indexOf('\n')) >= 0) {
          const line = this.pending.slice(0, index);
          this.pending = this.pending.slice(index + 1);
          if (Buffer.byteLength(line) + 1 > OMP_OBSERVATION_MAX_FRAME_BYTES) throw new Error('Native observation frame exceeded limit');
          const event: unknown = JSON.parse(line);
          if (!isOmpRuntimeObservation(event)) throw new Error('Native observation frame is malformed');
          this.onObservation(event);
        }
        if (Buffer.byteLength(this.pending) > OMP_OBSERVATION_MAX_FRAME_BYTES) throw new Error('Native observation frame exceeded limit');
      }
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
      this.pending = '';
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.drain();
    this.disposed = true;
    this.watcher?.close();
    closeSync(this.fd);
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export function isOmpRuntimeObservation(value: unknown): value is OmpRuntimeObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Partial<OmpRuntimeObservation>;
  return event.version === 1 && typeof event.id === 'string' && typeof event.runId === 'string'
    && typeof event.sourceId === 'string' && Number.isSafeInteger(event.sourceSeq) && (event.sourceSeq ?? 0) > 0
    && typeof event.observedAt === 'number' && Number.isFinite(event.observedAt)
    && typeof event.elapsedMs === 'number' && Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0
    && typeof event.nativeSessionId === 'string' && typeof event.hook === 'string'
    && typeof event.cwd === 'string' && !!event.agent && typeof event.agent.id === 'string'
    && (event.agent.kind === 'main' || event.agent.kind === 'sub')
    && typeof event.agent.name === 'string' && typeof event.agent.depth === 'number'
    && !!event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload);
}
