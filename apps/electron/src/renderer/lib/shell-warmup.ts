/**
 * PERF-10 (#1577) — shell wiring for the idle warm-up queue.
 *
 * Turns the ordered plan from `warmup.ts` into real reads. Each step uses the
 * same function its page uses, so the warmed result lands where the first visit
 * reads it: the session meta map (`refreshSessionsMetadataAtom`), the chat
 * loader (`ensureSessionMessagesLoadedAtom`), the shared note/agents/inbox/feed
 * cache (`lib/query`), the workspace-work snapshot the plan view paints from,
 * the skills/sources catalogs, local meetings, and the rail route chunks.
 *
 * `installShellWarmup()` runs when the shell has session metadata and an active
 * workspace; the returned stop cancels the queue (user input cancels it too)
 * and a workspace switch re-installs it. Every read is best-effort: a failure
 * is logged as `console.warn('[warmup] …')` and the queue continues; the shell
 * never falls over a background read.
 */
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import type { FeedListResult } from '@rox/shared/feed'
import type { WorkspaceWorkSnapshot } from '@rox/shared/workspace-work'
import type { ElectronAPI, LoadedSkill, LoadedSource } from '../../shared/types'
import { ensureSessionMessagesLoadedAtom, loadedSessionsAtom, refreshSessionsMetadataAtom, sessionMetaMapAtom, windowWorkspaceIdAtom } from '@/atoms/sessions'
import { RAIL_SURFACE_ROUTES, preloadRoute } from '@/components/app-shell/route-pages'
import { getShellStore, type ShellStore } from '@/platform/shell-store'
import { roxQueryClient } from '@/lib/query/client'
import { roxKeys } from '@/lib/query/keys'
import { fetchNotesList } from '@/lib/query/notes-cache'
import { cacheWriteEpoch, fencedSetQueryData, sharedRead } from '@/lib/query/shared-read'
import { meetsAnnouncedRevision } from '@/lib/query/workspace-work-revision'
import { getWorkspaceWorkClient } from '@/lib/workspace-work-client'
import {
  WarmupScheduler,
  buildWarmupSteps,
  detectLowMemory,
  probeOnBattery,
  warmupStepBudget,
  type WarmupDeps,
  type WarmupStatus,
  type WarmupStepId,
} from './warmup'

/** The queue of the most recent install; diagnostics read its status. */
let activeQueue: WarmupScheduler | null = null

/** Status of the warm-up queue (running or last finished), or null before the first install. */
export function warmupDiagnostics(): WarmupStatus | null {
  return activeQueue ? activeQueue.status() : null
}

if (typeof window !== 'undefined') {
  // Packaged probe hook (PERF-10): `warmup-heap-probe.ts` reads the queue over CDP.
  const probeWindow = window as Window & { __roxWarmup?: () => WarmupStatus | null }
  probeWindow.__roxWarmup = warmupDiagnostics
}

/**
 * Install the idle warm-up and return its stop. Called by the shell once
 * session metadata and the active workspace exist; `stop` cancels the queue
 * (unmount or workspace switch). No API or workspace means nothing to warm.
 */
export function installShellWarmup(): () => void {
  const store = getShellStore()
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  const workspaceId = store.get(windowWorkspaceIdAtom)
  if (!api || !workspaceId) {
    // Nothing to warm: clear the diagnostics of a previous install instead of
    // reporting a queue the shell no longer runs.
    activeQueue = null
    return () => {}
  }

  const steps = buildWarmupSteps(createShellWarmupDeps(api, store, workspaceId))
  let stopped = false
  void (async () => {
    const onBattery = await probeOnBattery()
    if (stopped) return
    // Low power (battery or ≤ 4 GB) keeps only the hottest steps.
    const stepCount = warmupStepBudget({ lowMemory: detectLowMemory(), onBattery }, steps.length)
    const queue = new WarmupScheduler(steps.slice(0, stepCount))
    if (stopped) return
    activeQueue = queue
    queue.start()
  })()
  return () => {
    stopped = true
    activeQueue?.cancel()
  }
}

/** Log, then rethrow so the scheduler records the step as failed and moves on. */
function bestEffort<Args extends readonly unknown[]>(
  id: WarmupStepId,
  run: (...args: Args) => unknown,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await run(...args)
    } catch (error) {
      console.warn(`[warmup] ${id} read failed`, error)
      throw error
    }
  }
}

function createShellWarmupDeps(api: ElectronAPI, store: ShellStore, workspaceId: string): WarmupDeps {
  // Steps 4 and 5 both read the catalogs; one read serves the raw warm-up and
  // the agents-catalog projection, so the skills scan does not run twice.
  let catalogs: Promise<{ sources: LoadedSource[]; skills: LoadedSkill[] }> | null = null
  const readCatalogs = () => (catalogs ??= Promise.all([api.getSources(workspaceId), api.getSkills(workspaceId)])
    .then(([sources, skills]) => ({ sources, skills })))
  return {
    // The same path that fills `sessionMetaMapAtom` (SessionList's rank refresh).
    warmSessionMeta: bestEffort('sessions-meta', async () => {
      const sessions = await api.getSessions()
      if (!Array.isArray(sessions)) return
      store.set(refreshSessionsMetadataAtom, {
        sessions,
        loadedSessionIds: store.get(loadedSessionsAtom),
        removeMissing: false,
      })
    }),
    // Most recently used user sessions of the workspace, newest first (the session list's order).
    recentSessionIds: (limit) => Array.from(store.get(sessionMetaMapAtom).values())
      .filter(meta => meta.workspaceId === workspaceId && !meta.isArchived && !meta.hidden && !isInternalAgentSession(meta))
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt ?? 0) - (a.lastMessageAt ?? a.createdAt ?? 0))
      .slice(0, limit)
      .map(meta => meta.id),
    // The chat loader ChatPage uses; it dedupes, skips loaded sessions and preserves streaming state.
    warmTranscriptTail: bestEffort('transcript-tails', async (sessionId: string) => {
      await store.set(ensureSessionMessagesLoadedAtom, sessionId)
    }),
    warmNotesAndTasks: bestEffort('notes-tasks', () => fetchNotesList(workspaceId, () => api.listNotes(workspaceId), { mount: true })),
    warmSkillsAndSources: bestEffort('skills-sources', () => readCatalogs()),
    // Same read + projection as AgentProfilesView's query under `roxKeys.agentsCatalog`.
    warmAgentProfiles: bestEffort('agent-profiles', () => sharedRead(roxQueryClient(), roxKeys.agentsCatalog(workspaceId), async () => {
      const { sources, skills } = await readCatalogs()
      return {
        sources: sources.filter(source => source.workspaceId === workspaceId).map(source => ({ slug: source.config.slug, name: source.config.name })),
        skills: [...new Map<string, AgentsCatalogItem>(skills.filter(skill => !skill.shadowedByCraft)
          .map(skill => [skill.slug, { slug: skill.slug, name: skill.metadata.name }])).values()],
      }
    }, { join: true })),
    warmInboxAndFeed: bestEffort('inbox-feed', () => Promise.all([warmInbox(api, workspaceId), warmFeed(api, workspaceId)])),
    // The plan view's week window (current week + `weeksAhead`) paints from the
    // same snapshot and meetings list, so the horizon needs no separate query.
    warmCalendar: bestEffort('calendar', () => warmCalendar(api, workspaceId)),
    // Fire-and-forget chunk loads: the memoized promises feed `React.lazy`;
    // a failure is logged and forgotten so the route's retry can try again.
    warmRouteChunks: () => {
      for (const name of RAIL_SURFACE_ROUTES) {
        void preloadRoute(name).catch(error => { console.warn(`[warmup] route-chunks failed for ${name}`, error) })
      }
    },
    routeChunkNames: RAIL_SURFACE_ROUTES,
  }
}

interface AgentsCatalogItem {
  slug: string
  name: string
}

/** The plan view paints the workspace-work snapshot (`useWorkspaceWork`) and the local meetings list. */
async function warmCalendar(api: ElectronAPI, workspaceId: string): Promise<void> {
  const meetings = api.meetingsLocal ? api.meetingsLocal.list(workspaceId) : null
  if (typeof api.workspaceWorkRead !== 'function') {
    if (meetings) await meetings
    return
  }
  const snapshot = sharedRead(roxQueryClient(), roxKeys.workspaceWork(workspaceId), () => getWorkspaceWorkClient(workspaceId).read(), {
    join: true,
    replaces: (next: WorkspaceWorkSnapshot, cached: WorkspaceWorkSnapshot | undefined) =>
      meetsAnnouncedRevision(next) && (!cached || cached.revision <= next.revision),
  })
  if (meetings) await Promise.all([snapshot, meetings])
  else await snapshot
}

/** The inbox actor key `useInboxActorContext` verifies; null when no identity is available. */
async function resolveInboxActorKey(api: ElectronAPI, workspaceId: string): Promise<string | null> {
  if (typeof api.identityGetState !== 'function') return 'legacy'
  const [state, identity] = await Promise.all([
    api.identityGetState({ workspaceId }),
    api.getOrgIdentity ? api.getOrgIdentity() : Promise.resolve(null),
  ])
  if (!identity?.userId) return null
  const valid = identity.authority === 'local'
    || (identity.authority === 'native' && !!identity.issuer && state?.annotationActorId === identity.userId)
  if (!valid) return null
  return JSON.stringify([identity.authority, identity.issuer ?? '', identity.userId])
}

/** The feed caller key `useFeedCaller` verifies; null when the caller cannot be established. */
async function resolveFeedCallerKey(api: ElectronAPI, workspaceId: string): Promise<string | null> {
  if (typeof api.getOrgIdentity !== 'function' || typeof api.getWindowWorkspace !== 'function') return null
  const identity = await api.getOrgIdentity()
  if (!identity?.userId
    || (identity.authority !== 'local' && identity.authority !== 'native')
    || (identity.authority === 'native' && !identity.issuer)) return null
  const bound = await api.getWindowWorkspace()
  if (bound !== workspaceId) return null
  return JSON.stringify([identity.authority, identity.issuer ?? null, identity.userId, workspaceId])
}

/** The three remote sources `useInboxItems` reads for the Входящие page, into the shared cache. */
async function warmInbox(api: ElectronAPI, workspaceId: string): Promise<void> {
  const actorKey = await resolveInboxActorKey(api, workspaceId)
  if (!actorKey) return
  const client = roxQueryClient()
  const memory = api.listMemoryProposals ? () => api.listMemoryProposals(workspaceId) : null
  const skills = api.listPendingSkills ? () => api.listPendingSkills(workspaceId) : null
  const senders = api.getMessagingPendingSenders ? () => api.getMessagingPendingSenders() : null
  const jobs: Array<Promise<unknown>> = []
  if (memory) jobs.push(sharedRead(client, roxKeys.inbox(workspaceId, actorKey, 'memory'), async () => (await memory()) ?? [], { join: true }))
  if (skills) jobs.push(sharedRead(client, roxKeys.inbox(workspaceId, actorKey, 'skills'), async () => (await skills()) ?? [], { join: true }))
  if (senders) jobs.push(sharedRead(client, roxKeys.inbox(workspaceId, actorKey, 'senders'), async () => (await senders()) ?? [], { join: true }))
  await Promise.all(jobs)
}

/** `FeedPage`'s read: the caller-bound feed list, written fenced under its preference key. */
async function warmFeed(api: ElectronAPI, workspaceId: string): Promise<void> {
  const callerKey = await resolveFeedCallerKey(api, workspaceId)
  if (!callerKey || typeof api.feedList !== 'function') return
  const epoch = cacheWriteEpoch()
  const result: FeedListResult | undefined = await api.feedList(workspaceId)
  if (result) fencedSetQueryData(roxQueryClient(), roxKeys.feed(workspaceId, callerKey), result, epoch)
}