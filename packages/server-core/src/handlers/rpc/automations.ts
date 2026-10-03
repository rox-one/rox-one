import { createHash } from 'node:crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@rox/shared/protocol'
import { getWorkspaceByNameOrId } from '@rox/shared/config'
import { appendAutomationHistoryEntry } from '@rox/shared/automations/history-store'
import { awardXpSafe } from '@rox/shared/gamification'
import { AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER } from '@rox/shared/automations/constants'
import { atomicWriteFileSync } from '@rox/shared/utils/files'
import {
  buildAutomationGraphSave,
  getAutomationGraphProjection,
  parseSaveAutomationGraphPayload,
} from '@rox/shared/automations/graph'
import { resolveAutomationsConfigPath, generateShortId } from '@rox/shared/automations/resolve-config-path'
import { ensureDefaultAutomations } from '@rox/shared/automations/default-seeds'
import { validateAutomationsConfig } from '@rox/shared/automations/validation'
import { pushTyped, type RpcServer } from '@rox/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { isClaimableLive, rpcAutomationsActResult, rpcAutomationsListResult, rpcAutomationsReadResult } from '@rox/core/rox2'

// History file name — matches AUTOMATIONS_HISTORY_FILE from @rox/shared/automations/constants
const HISTORY_FILE = 'automations-history.jsonl'
interface HistoryEntry { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string; webhook?: { method: string; url: string; statusCode: number; durationMs: number; attempts?: number; error?: string; responseBody?: string } }

// Per-workspace config mutex: serializes read-modify-write cycles on automations.json
// to prevent concurrent IPC calls from clobbering each other's changes.
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run fn regardless of previous result
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

// Shared helper: resolve workspace, read automations.json, validate matcher, mutate, write back
interface AutomationsConfigJson { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
function redactWebhookCredentials(raw: AutomationsConfigJson): AutomationsConfigJson {
  const config = JSON.parse(JSON.stringify(raw)) as AutomationsConfigJson
  for (const matchers of Object.values(config.automations ?? {})) {
    for (const matcher of matchers) {
      matcher._editorRevision = createHash('sha256').update(JSON.stringify(matcher)).digest('hex')
      if (!Array.isArray(matcher.actions)) continue
      matcher.actions = matcher.actions.map((value) => {
        const action = value as Record<string, unknown>
        if (action.type !== 'webhook' || !action.auth || typeof action.auth !== 'object') return action
        const auth = action.auth as { type?: unknown }
        delete action.auth
        action.authConfigured = true
        action.authType = auth.type
        return action
      })
    }
  }
  return config
}

function redactWebhookGraphCredentials<T>(projection: T): T {
  const result = JSON.parse(JSON.stringify(projection)) as Record<string, unknown>
  const graph = result.graph as { nodes?: Array<{ kind?: string; data?: Record<string, unknown> }> } | undefined
  for (const node of graph?.nodes ?? []) {
    if (node.kind !== 'webhook' || !node.data?.auth || typeof node.data.auth !== 'object') continue
    const auth = node.data.auth as { type?: unknown }
    delete node.data.auth
    node.data.authConfigured = true
    node.data.authType = auth.type
  }
  return result as T
}
async function withAutomationMatcher<T = void>(workspaceId: string, eventName: string, matcherIndex: number, mutate: (matchers: Record<string, unknown>[], index: number, config: AutomationsConfigJson, genId: () => string) => T): Promise<T> {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')

  return withConfigMutex(workspace.rootPath, async () => {
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const eventMap = config.automations ?? {}
    const matchers = eventMap[eventName]
    if (!Array.isArray(matchers) || matcherIndex < 0 || matcherIndex >= matchers.length) {
      throw new Error(`Invalid automation reference: ${eventName}[${matcherIndex}]`)
    }

    const result = mutate(matchers, matcherIndex, config, generateShortId)

    // Backfill missing IDs on all matchers before writing
    for (const eventMatchers of Object.values(eventMap)) {
      if (!Array.isArray(eventMatchers)) continue
      for (const m of eventMatchers as Record<string, unknown>[]) {
        if (!m.id) m.id = generateShortId()
      }
    }

    atomicWriteFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
    return result
  })
}

/** Keys the automations editor may write on a matcher. Anything else already
 *  on the matcher (graph metadata, attributeAllowList, …) is preserved. */
const EDITABLE_MATCHER_KEYS = [
  'name', 'matcher', 'cron', 'timezone', 'permissionMode', 'labels',
  'enabled', 'conditions', 'telegramTopic', 'actions',
] as const

const KNOWN_EVENTS = new Set<string>([
  'LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange',
  'TodoStateChange', 'SessionStatusChange', 'SchedulerTick',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact',
  'PermissionRequest', 'Setup',
])

interface AutomationEditPayload { event: string; matcher: Record<string, unknown>; expectedRevision?: string }

function parseEditPayload(raw: unknown): AutomationEditPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid automation payload')
  const { event, matcher, expectedRevision } = raw as { event?: unknown; matcher?: unknown; expectedRevision?: unknown }
  if (typeof event !== 'string' || !KNOWN_EVENTS.has(event)) throw new Error(`Unknown automation event: ${String(event)}`)
  if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) throw new Error('Invalid automation matcher')
  if (expectedRevision !== undefined && typeof expectedRevision !== 'string') throw new Error('Invalid automation revision')
  return { event, matcher: matcher as Record<string, unknown>, expectedRevision }
}

/** Merge editable fields onto `base` (undefined / empty removes the key). */
function applyMatcherEdit(base: Record<string, unknown>, edit: Record<string, unknown>, event: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base }
  for (const key of EDITABLE_MATCHER_KEYS) {
    if (!(key in edit)) continue
    const value = edit[key]
    const empty = value === undefined || value === null || value === ''
      || (Array.isArray(value) && value.length === 0 && key !== 'actions')
    if (empty) delete next[key]
    else next[key] = value
  }
  if (next.enabled === true) delete next.enabled
  // Cron only applies to SchedulerTick; regex matchers never do.
  if (event === 'SchedulerTick') delete next.matcher
  else { delete next.cron; delete next.timezone }
  return next
}

function applyWebhookCredentialEdit(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  mode: unknown,
): void {
  if (!Array.isArray(next.actions) || !Array.isArray(current.actions)) return
  for (let index = 0; index < next.actions.length; index += 1) {
    const action = next.actions[index] as Record<string, unknown>
    if (action.type !== 'webhook') continue
    const oldAction = current.actions[index] as Record<string, unknown> | undefined
    if (mode === 'keep' && !action.auth && oldAction?.type === 'webhook') action.auth = oldAction.auth
    if (mode === 'none') delete action.auth
    delete action.authConfigured
    delete action.authType
  }
}

/** Validate a single matcher in isolation so an unrelated legacy entry elsewhere
 *  in automations.json cannot block editing this one. */
function assertValidMatcher(event: string, matcher: Record<string, unknown>): void {
  const actions = Array.isArray(matcher.actions) ? matcher.actions as Array<Record<string, unknown>> : []
  if (actions.length === 0) throw new Error('At least one action is required')
  for (const action of actions) {
    if (action?.type === 'prompt' && (typeof action.prompt !== 'string' || action.prompt.trim() === '')) {
      throw new Error('Prompt cannot be empty')
    }
  }
  const validation = validateAutomationsConfig({ version: 2, automations: { [event]: [matcher] } })
  if (!validation.valid) throw new Error(validation.errors.join('; '))
}

async function readConfigOrEmpty(configPath: string): Promise<AutomationsConfigJson> {
  try {
    return JSON.parse(await readFile(configPath, 'utf-8')) as AutomationsConfigJson
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 2, automations: {} }
    }
    throw error
  }
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.automations.GET,
  RPC_CHANNELS.automations.GET_GRAPH,
  RPC_CHANNELS.automations.TEST,
  RPC_CHANNELS.automations.SET_ENABLED,
  RPC_CHANNELS.automations.DUPLICATE,
  RPC_CHANNELS.automations.UPDATE,
  RPC_CHANNELS.automations.CREATE,
  RPC_CHANNELS.automations.DELETE,
  RPC_CHANNELS.automations.GET_HISTORY,
  RPC_CHANNELS.automations.GET_LAST_EXECUTED,
  RPC_CHANNELS.automations.REPLAY,
  RPC_CHANNELS.automations.SAVE_GRAPH,
] as const

export function registerAutomationsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  // Mutations push CHANGED directly so every window refreshes immediately,
  // independent of the (debounced) config file watcher.
  const notifyChanged = (workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    const id = workspace?.id ?? workspaceId
    pushTyped(server, RPC_CHANNELS.automations.CHANGED, { to: 'workspace', workspaceId: id }, id)
  }

  // Get automations config for a workspace (read-only, resolves path server-side)
  server.handle(RPC_CHANNELS.automations.GET, async (_ctx, workspaceId: string) => {
    const listed = rpcAutomationsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) return null
    log.info(`AUTOMATIONS_GET: Loading automations for workspace: ${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`AUTOMATIONS_GET: Workspace not found: ${workspaceId}`)
      return null
    }
    try {
      return await withConfigMutex(workspace.rootPath, async () => {
        // Existing seed lifecycle stays serialized with graph saves. The graph
        // projection itself never calls this writer.
        ensureDefaultAutomations(workspace.rootPath)
        const configPath = resolveAutomationsConfigPath(workspace.rootPath)
        log.info(`AUTOMATIONS_GET: Reading config from: ${configPath}`)
        const content = await readFile(configPath, 'utf-8')
        const parsed = JSON.parse(content)
        const eventCount = parsed?.automations ? Object.keys(parsed.automations).length : 0
        log.info(`AUTOMATIONS_GET: Loaded ${eventCount} event type(s) from ${configPath}`)
        return redactWebhookCredentials(parsed)
      })
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`AUTOMATIONS_GET: No automations.json found for workspace ${workspaceId}`)
        return null // No automations configured yet
      }
      log.error(`AUTOMATIONS_GET: Error loading automations:`, error)
      throw error
    }
  })
  // Keep graph authoring read-only until its explicit save action. In
  // particular, do not call ensureDefaultAutomations here: an absent document
  // projects a default graph without creating a config file.
  server.handle(RPC_CHANNELS.automations.GET_GRAPH, async (_ctx, workspaceId: string) => {
    const listed = rpcAutomationsListResult({ source: 'native' })
    if (!isClaimableLive(listed.result)) throw new Error('automations graph list is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    return withConfigMutex(workspace.rootPath, async () => {
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)
      try {
        return redactWebhookGraphCredentials(getAutomationGraphProjection(JSON.parse(await readFile(configPath, 'utf-8'))))
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          return getAutomationGraphProjection(null)
        }
        throw error
      }
    })
  })


  // Compile graph metadata into canonical matchers/actions, then atomically
  // replace automations.json while holding the same mutex as legacy mutations.
  server.handle(RPC_CHANNELS.automations.SAVE_GRAPH, async (_ctx, rawPayload: unknown) => {
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: 'graph' })
    if (!isClaimableLive(act)) throw new Error('automations graph write is not live')
    const payload = parseSaveAutomationGraphPayload(rawPayload)
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    return withConfigMutex(workspace.rootPath, async () => {
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)
      let currentConfig: unknown

      try {
        currentConfig = JSON.parse(await readFile(configPath, 'utf-8'))
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
        // A first graph save is a direct config creation, not a request to add
        // the unrelated default seed set.
        currentConfig = { version: 2, automations: {} }
      }

      const saved = buildAutomationGraphSave(currentConfig, payload)
      const validation = validateAutomationsConfig(saved.config)
      if (!validation.valid) throw new Error(`Compiled automation configuration is invalid: ${validation.errors.join('; ')}`)
      atomicWriteFileSync(configPath, JSON.stringify(saved.config, null, 2) + '\n')
      pushTyped(
        server,
        RPC_CHANNELS.automations.CHANGED,
        { to: 'workspace', workspaceId: payload.workspaceId },
        payload.workspaceId,
      )
      return saved
    })
  })

  server.handle(RPC_CHANNELS.automations.TEST, async (_ctx, payload: import('@rox/shared/protocol').TestAutomationPayload) => {
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const results: import('@rox/shared/protocol').TestAutomationActionResult[] = []
    const { parsePromptReferences } = await import('@rox/shared/automations')
    const { executeWebhookRequest, createWebhookHistoryEntry, createPromptHistoryEntry } = await import('@rox/shared/automations/webhook-utils')

    let actionsToTest = payload.actions
    if (payload.automationId) {
      const saved = await readConfigOrEmpty(resolveAutomationsConfigPath(workspace.rootPath))
      const matcher = Object.values(saved.automations ?? {}).flat().find((candidate) => candidate.id === payload.automationId)
      const savedActions = Array.isArray(matcher?.actions) ? matcher.actions : []
      actionsToTest = payload.actions.map((action, index) => {
        const requested = action as typeof action & { authConfigured?: boolean; authType?: string }
        if (requested.type !== 'webhook' || !requested.authConfigured) return action
        const savedAction = savedActions[index] as Record<string, unknown> | undefined
        if (savedAction?.type !== 'webhook' || !savedAction.auth) throw new Error('Saved webhook credential is unavailable; reload before testing')
        const { authConfigured: _configured, authType: _authType, ...safeAction } = requested
        return { ...safeAction, auth: savedAction.auth } as typeof action
      })
    }

    for (const action of actionsToTest) {
      const start = Date.now()

      if (action.type === 'webhook') {
        // Execute webhook action using shared utility (no env expansion for test — raw URLs)
        // Cast needed: protocol DTO uses loose `method?: string`, WebhookAction uses strict union
        const result = await executeWebhookRequest(action as import('@rox/shared/automations').WebhookAction)
        const method = action.method ?? 'POST'

        results.push({
          ...result,
          duration: Date.now() - start,
        })

        if (payload.automationId) {
          const entry = createWebhookHistoryEntry({
            matcherId: payload.automationId,
            ok: result.success,
            method,
            url: action.url as string,
            statusCode: result.statusCode,
            durationMs: result.durationMs ?? 0,
            error: result.error,
            responseBody: result.responseBody,
          })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
            awardXpSafe('automation_ran')
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
        continue
      }

      if (action.type === 'script') {
        // Execute the script through the same executor the ScriptHandler uses,
        // with a synthesized SchedulerTick env (tests simulate the cron path).
        // Timeout is clamped below the 30s RPC timeout so a slow script fails
        // the test visibly instead of tripping the transport (see #943).
        const { executeScriptAction, createScriptHistoryEntry, buildScriptEnv } = await import('@rox/shared/automations')
        const env = buildScriptEnv(
          'SchedulerTick',
          { workspaceId: payload.workspaceId, timestamp: Date.now() },
          { workspaceRootPath: workspace.rootPath, page: action.page },
        )
        const result = await executeScriptAction(
          {
            type: 'script',
            script: action.script,
            args: action.args,
            runtime: action.runtime,
            timeoutMs: Math.min(action.timeoutMs ?? 25_000, 25_000),
            page: action.page,
          },
          { workspaceRootPath: workspace.rootPath, env },
        )

        results.push({
          type: 'script',
          success: result.success,
          script: result.script,
          exitCode: result.exitCode,
          ...(result.stdout ? { stdout: result.stdout.slice(0, 2000) } : {}),
          ...(result.success || !result.stderr ? {} : { error: result.stderr.slice(0, 2000) }),
          duration: Date.now() - start,
        })

        if (payload.automationId) {
          const entry = createScriptHistoryEntry({ matcherId: payload.automationId, result })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
        continue
      }

      // Prompt action
      // Parse @mentions from the prompt to resolve source/skill references
      const references = parsePromptReferences(action.prompt)

      try {
        const { sessionId } = await deps.sessionManager.executePromptAutomation({
          workspaceId: payload.workspaceId,
          workspaceRootPath: workspace.rootPath,
          prompt: action.prompt,
          labels: payload.labels,
          permissionMode: payload.permissionMode,
          mentions: references.mentions,
          llmConnection: action.llmConnection,
          model: action.model,
          thinkingLevel: action.thinkingLevel,
          automationName: payload.automationName,
          telegramTopic: payload.telegramTopic,
          // Test = "did it launch + start producing output", not "did the whole
          // turn finish". Return once the session is created so a long run doesn't
          // trip the 30s RPC timeout (craft-agents-oss#943).
          waitForCompletion: false,
        })
        results.push({
          type: 'prompt',
          success: true,
          sessionId,
          duration: Date.now() - start,
        })

        // Write history entry for test runs
        if (payload.automationId) {
          const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: true, sessionId, prompt: action.prompt })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
            awardXpSafe('automation_ran')
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
      } catch (err: unknown) {
        results.push({
          type: 'prompt',
          success: false,
          stderr: (err as Error).message,
          duration: Date.now() - start,
        })

        // Write failed history entry
        if (payload.automationId) {
          const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: false, error: (err as Error).message, prompt: action.prompt })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
            awardXpSafe('automation_ran')
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
      }
    }

    // History changed (and lastExecutedAt with it) — let lists refresh.
    if (payload.automationId) notifyChanged(payload.workspaceId)
    return { actions: results } satisfies import('@rox/shared/protocol').TestAutomationResult
  })

  // Automation enabled state management (toggle enabled/disabled in automations.json)
  server.handle(RPC_CHANNELS.automations.SET_ENABLED, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean) => {
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: eventName })
    if (!isClaimableLive(act)) return
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      if (enabled) {
        delete matchers[idx].enabled
      } else {
        matchers[idx].enabled = false
      }
    })
    notifyChanged(workspaceId)
  })

  // Duplicate an automation matcher. `copyName` is the clone's name already
  // localized by the client (e.g. «Имя (копия)»); without it the legacy
  // English " Copy" suffix is used.
  server.handle(RPC_CHANNELS.automations.DUPLICATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, copyName?: unknown) => {
    const localizedName = typeof copyName === 'string' ? copyName.trim().slice(0, 200) : ''
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: eventName })
    if (!isClaimableLive(act)) return
    const id = await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(matchers[idx]))
      clone.id = genId()
      clone.name = localizedName || (clone.name ? `${clone.name} Copy` : 'Untitled Copy')
      matchers.splice(idx + 1, 0, clone)
      return clone.id as string
    })
    notifyChanged(workspaceId)
    return { id }
  })

  // Replace one matcher's editable fields (id and unknown keys preserved).
  // Changing the event moves the matcher to the end of that event's list.
  server.handle(RPC_CHANNELS.automations.UPDATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, rawPayload: unknown) => {
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: eventName })
    if (!isClaimableLive(act)) throw new Error('automations update is not live')
    const payload = parseEditPayload(rawPayload)
    const result = await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config, genId) => {
      const current = matchers[idx]!
      if (payload.expectedRevision !== undefined && createHash('sha256').update(JSON.stringify(current)).digest('hex') !== payload.expectedRevision) {
        throw new Error('Automation changed since it was loaded; reload before saving')
      }
      const next = applyMatcherEdit(current, payload.matcher, payload.event)
      applyWebhookCredentialEdit(current, next, payload.matcher.webhookAuthMode)
      if (!next.id) next.id = genId()
      assertValidMatcher(payload.event, next)
      if (payload.event === eventName) {
        matchers[idx] = next
        return { id: next.id as string, event: eventName, matcherIndex: idx }
      }
      const eventMap = (config.automations ??= {})
      matchers.splice(idx, 1)
      if (matchers.length === 0) delete eventMap[eventName]
      const target = (eventMap[payload.event] ??= [])
      target.push(next)
      return { id: next.id as string, event: payload.event, matcherIndex: target.length - 1 }
    })
    notifyChanged(workspaceId)
    return result
  })

  // Append a new matcher (creates automations.json if missing, without seeding).
  server.handle(RPC_CHANNELS.automations.CREATE, async (_ctx, workspaceId: string, rawPayload: unknown) => {
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: 'create' })
    if (!isClaimableLive(act)) throw new Error('automations create is not live')
    const payload = parseEditPayload(rawPayload)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const result = await withConfigMutex(workspace.rootPath, async () => {
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)
      const config = await readConfigOrEmpty(configPath)
      const next = applyMatcherEdit({ id: generateShortId() }, payload.matcher, payload.event)
      assertValidMatcher(payload.event, next)
      const eventMap = (config.automations ??= {})
      const target = (eventMap[payload.event] ??= [])
      target.push(next)
      atomicWriteFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
      return { id: next.id as string, event: payload.event, matcherIndex: target.length - 1 }
    })
    notifyChanged(workspaceId)
    return result
  })

  // Delete an automation matcher
  server.handle(RPC_CHANNELS.automations.DELETE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    const act = rpcAutomationsActResult({
      source: 'native',
      action: 'destroy',
      granted: true,
      nativeId: eventName,
    })
    if (!isClaimableLive(act)) return
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      matchers.splice(idx, 1)
      if (matchers.length === 0) {
        const eventMap = config.automations
        if (eventMap) delete eventMap[eventName]
      }
    })
    notifyChanged(workspaceId)
  })

  // Read execution history for a specific automation
  server.handle(RPC_CHANNELS.automations.GET_HISTORY, async (_ctx, workspaceId: string, automationId: string, limit = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER) => {
    const read = rpcAutomationsReadResult({ source: 'native', nativeId: automationId })
    if (!isClaimableLive(read.result)) return []
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const clampedLimit = Math.max(1, Math.min(limit, AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER))
    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      return lines
        .map(line => { try { return JSON.parse(line) } catch { return null } })
        .filter((e): e is HistoryEntry => e?.id === automationId)
        .slice(-clampedLimit)
        .reverse()
    } catch {
      return [] // File doesn't exist yet
    }
  })

  // Replay webhook actions for a specific automation matcher
  server.handle(RPC_CHANNELS.automations.REPLAY, async (_ctx, workspaceId: string, automationId: string, eventName: string) => {
    const act = rpcAutomationsActResult({ source: 'native', action: 'write', nativeId: automationId })
    if (!isClaimableLive(act)) throw new Error('automations replay is not live')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { resolveAutomationsConfigPath } = await import('@rox/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as { automations?: Record<string, Array<{ id?: string; actions?: Array<{ type: string; [key: string]: unknown }> }>> }

    const matchers = config.automations?.[eventName] ?? []
    const matcher = matchers.find(m => m.id === automationId)
    if (!matcher) throw new Error('Automation not found')

    const webhookActions = (matcher.actions ?? []).filter(a => a.type === 'webhook')
    if (webhookActions.length === 0) {
      const hasScripts = (matcher.actions ?? []).some(a => a.type === 'script')
      throw new Error(hasScripts
        ? 'No webhook actions to replay — script actions re-run via "Run test"'
        : 'No webhook actions to replay')
    }

    const { executeWebhookRequest, createWebhookHistoryEntry } = await import('@rox/shared/automations/webhook-utils')
    const results = await Promise.all(
      webhookActions.map(a => executeWebhookRequest(a as unknown as import('@rox/shared/automations').WebhookAction))
    )

    // Write history entries for replay — use index to correctly attribute method per action
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const action = webhookActions[i]!
      const entry = createWebhookHistoryEntry({
        matcherId: automationId,
        ok: result.success,
        method: (action as { method?: string }).method,
        url: result.url,
        statusCode: result.statusCode,
        durationMs: result.durationMs ?? 0,
        error: result.error,
      })
      try {
        await appendAutomationHistoryEntry(workspace.rootPath, entry)
            awardXpSafe('automation_ran')
      } catch (e) {
        log.warn('[Automations] Failed to write replay history:', e)
      }
    }

    return { results: results.map(r => ({ ...r, duration: r.durationMs ?? 0 })) }
  })

  // Return last execution timestamp for all automations
  // `detailed` adds the last run's ok flag: { [id]: { ts, ok } } instead of { [id]: ts }.
  server.handle(RPC_CHANNELS.automations.GET_LAST_EXECUTED, async (_ctx, workspaceId: string, detailed?: boolean) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const historyPath = join(workspace.rootPath, HISTORY_FILE)
    try {
      const content = await readFile(historyPath, 'utf-8')
      const result: Record<string, number | { ts: number; ok: boolean }> = {}
      for (const line of content.trim().split('\n')) {
        try {
          const entry = JSON.parse(line)
          if (entry.id && entry.ts) result[entry.id] = detailed ? { ts: entry.ts, ok: entry.ok !== false } : entry.ts
        } catch { /* skip malformed lines */ }
      }
      return result
    } catch {
      return {}
    }
  })
}
