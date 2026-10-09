/**
 * W1-14 (#1511) — Presence fanout in the workspace service (TECH-SPEC §11.1).
 *
 * The command handlers of `@rox/server-core/collab` keep the presence store;
 * deciding **who hears about a transition** is a server question, because the
 * answer is the caller's chat and space co-membership. This module holds that
 * lookup and the publication of the `presence.changed` frames, and the
 * realtime gateway calls it after a `presence.heartbeat` receipt.
 *
 * The store's audience lookup is wired from here (`configure`), so the receipt
 * already carries the right `notify` list.
 */

import { userTopic } from '@rox/core/events'
import { collabPresenceStore } from '@rox/server-core/collab'

/** The people who share a chat or a space with `principalId`. */
export type PresenceShareLookup = (workspaceId: string, principalId: string) => Promise<readonly string[]>

export interface PresenceFanoutOptions {
  sharesWith: PresenceShareLookup
  /** Publish one `presence.changed` frame (the realtime gateway or a test double). */
  publish: (topic: string, payload: Record<string, unknown>) => void | Promise<void>
}

export interface PresenceHeartbeatReceipt {
  status: string
  expiresAt: number
  /** Principals that receive `presence.changed` (the actor is excluded already). */
  notify: string[]
  from?: string | null
  to?: string
}

export interface PresenceFanout {
  /** Wire the store's audience lookup; returns a restore function. */
  configure(): () => void
  /** Publish the frames a heartbeat receipt asks for; returns the topics written. */
  publishHeartbeat(workspaceId: string, principalId: string, receipt: PresenceHeartbeatReceipt): Promise<string[]>
}

export function createPresenceFanout(options: PresenceFanoutOptions): PresenceFanout {
  const store = collabPresenceStore()
  return {
    configure() {
      // The store keeps the decision; this module owns the membership query.
      store.setAudienceLookup(options.sharesWith)
      return () => store.setAudienceLookup(async () => [])
    },
    async publishHeartbeat(workspaceId, principalId, receipt) {
      if (receipt.notify.length === 0) return []
      const payload: Record<string, unknown> = {
        principalId,
        status: receipt.status,
        at: new Date().toISOString(),
        ...(receipt.from !== undefined ? { from: receipt.from } : {}),
        ...(receipt.to ? { to: receipt.to } : {}),
      }
      const topics: string[] = []
      for (const audience of receipt.notify) {
        const topic = userTopic(audience)
        await options.publish(topic, payload)
        topics.push(topic)
      }
      return topics
    },
  }
}
