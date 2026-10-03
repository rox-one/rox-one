import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const directory = mkdtempSync(join(tmpdir(), 'rox-queue-review-'))
process.env.ROX_CONFIG_DIR = join(directory, 'config')
mkdirSync(process.env.ROX_CONFIG_DIR)
writeFileSync(join(process.env.ROX_CONFIG_DIR, 'config.json'), JSON.stringify({ workspaces: [], llmConnections: [] }))
const { SessionManager, createManagedSession } = await import('../../../../sessions/SessionManager')
const workspace = { id: 'workspace', name: 'Review', slug: 'review', rootPath: join(directory, 'workspace'), createdAt: 1 }
mkdirSync(workspace.rootPath)
const managed = createManagedSession({ id: 'review-session', name: 'Pre-existing title' }, workspace)
let redirects = 0
managed.agent = { redirect: () => { redirects++; return false } } as any
const manager = Object.create(SessionManager.prototype) as any
manager.sessions = new Map([[managed.id, managed]])
manager.nativeMemoryContexts = new Map()
manager.nativeMemoryStarts = new Map()
manager.browserHostByCanvas = new Map()
manager.ensureMessagesLoaded = async () => {}
let timestamp = 100, persists = 0
manager.monotonic = () => ++timestamp
manager.persistSession = () => { persists++ }
const events: any[] = []
manager.sendEvent = (event: any) => { events.push(structuredClone(event)) }
manager.setProcessing = () => { throw new Error('REVIEW_STOP_BEFORE_MODEL') }
manager.onProcessingStopped = () => {}
let signalEntered!: () => void, releaseFlush!: () => void
const entered = new Promise<void>(resolve => { signalEntered = resolve })
const heldFlush = new Promise<void>(resolve => { releaseFlush = resolve })
let flushCount = 0
manager.flushSession = async () => { if (++flushCount === 1) { signalEntered(); await heldFlush } }
let bValid = true
const actorA = { owner: { issuer: 'issuer', subject: 'A' }, assertAuthorized() {} }
const actorB = { owner: { issuer: 'issuer', subject: 'B' }, assertAuthorized() { if (!bValid) throw new Error('REVOKED_B') } }
const checks: Record<string, boolean> = {}
try {
  const first = manager.sendMessage(managed.id, 'A turn', undefined, undefined, undefined, undefined, undefined, () => { throw new Error('REVIEW_STOP_AFTER_ACK') }, { callerClientId: 'client-A', nativeMemoryContext: actorA }).catch((error: Error) => { assert.equal(error.message, 'REVIEW_STOP_AFTER_ACK') })
  await entered
  assert.equal(manager.nativeMemoryContexts.get(managed.id).owner.subject, 'A')
  await manager.sendMessage(managed.id, 'B queued turn', undefined, undefined, undefined, undefined, undefined, undefined, { callerClientId: 'client-B', nativeMemoryContext: actorB })
  assert.equal(managed.messageQueue.length, 1)
  assert.equal(manager.nativeMemoryContexts.get(managed.id).owner.subject, 'A')
  assert.equal(managed.messageQueue[0]!.rpcContext!.nativeMemoryContext!.owner.subject, 'B')
  assert.equal(managed.messageQueue[0]!.rpcContext!.callerClientId, 'client-B')
  assert.equal(redirects, 0, 'an idle agent must not receive a pre-start queued message')
  actorB.owner.subject = 'mutated-external-context'
  assert.equal(managed.messageQueue[0]!.rpcContext!.nativeMemoryContext!.owner.subject, 'B')
  actorB.owner.subject = 'B'
  checks.active_a_not_overwritten_during_flush = true
  checks.queued_b_context_copied_and_carried = true
  checks.queued_b_client_context_carried = true
  checks.idle_agent_not_steered = true
  releaseFlush(); await first
  assert.equal(manager.nativeMemoryStarts.size, 0)
  manager.processNextQueuedMessage(managed.id)
  for (let attempt = 0; attempt < 200 && (manager.nativeMemoryContexts.get(managed.id)?.owner.subject !== 'B' || manager.nativeMemoryStarts.size); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(manager.nativeMemoryContexts.get(managed.id).owner.subject, 'B')
  assert.equal(managed.messageQueue.length, 0)
  checks.replayed_b_binds_b_before_model = true
  managed.isProcessing = true
  await manager.sendMessage(managed.id, 'A queued during B processing', undefined, undefined, undefined, undefined, undefined, undefined, { callerClientId: 'client-A', nativeMemoryContext: actorA })
  assert.equal(manager.nativeMemoryContexts.get(managed.id).owner.subject, 'B')
  assert.equal(managed.messageQueue[0]!.rpcContext!.nativeMemoryContext!.owner.subject, 'A')
  managed.isProcessing = false
  manager.processNextQueuedMessage(managed.id)
  for (let attempt = 0; attempt < 200 && (manager.nativeMemoryContexts.get(managed.id)?.owner.subject !== 'A' || manager.nativeMemoryStarts.size); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(manager.nativeMemoryContexts.get(managed.id).owner.subject, 'A')
  assert.equal(managed.messageQueue.length, 0)
  checks.processing_b_not_overwritten_by_queued_a = true
  const queued = { id: 'revoked-B-message', role: 'user', content: 'revoked', timestamp: 42, isQueued: true }
  managed.messages.push(queued as any)
  managed.messageQueue.push({ message: 'revoked', messageId: queued.id, rpcContext: { nativeMemoryContext: actorB } })
  const before = { persists, events: events.length, timestamp: queued.timestamp, queued: queued.isQueued }
  bValid = false
  manager.processNextQueuedMessage(managed.id)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual({ persists, events: events.length, timestamp: queued.timestamp, queued: queued.isQueued }, before)
  assert.equal(managed.messageQueue.length, 0)
  checks.revoked_b_no_bookkeeping_persist_or_event = true
  assert.equal(Object.values(checks).every(Boolean), true)
  console.log('native Inbox queued turn passed')
} finally { rmSync(directory, { recursive: true, force: true }) }
