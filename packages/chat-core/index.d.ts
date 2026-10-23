/**
 * @rox/chat-core — frozen TypeScript surface.
 *
 * Part of the Rox native chat client. Portions derived from Block's Buzz
 * (https://github.com/block/buzz), Apache-2.0 — see NOTICE at the repo root.
 *
 * These declarations are hand-written and MUST stay in sync with the napi-rs
 * bindings in `native/crates/rox-chat-core/src/napi_bindings.rs`.
 */

export interface ChatCoreOptions {
  relayUrl: string;
  dbPath: string;
  secretKeyHex: string;
  channels?: string[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  pubkey: string;
  content: string;
  createdAt: number;
  kind: number;
  tags: string[][];
  editedAt?: number;
  deletedAt?: number;
  pending?: boolean;
}

export interface PresenceEntry {
  userId: string;
  pubkey: string;
  status: 'online' | 'away' | 'offline';
  lastSeenAt: number;
}

export interface TypingEntry {
  channelId: string;
  pubkey: string;
  until: number;
}

export type ChatCoreStatus = { state: 'connected' | 'reconnecting' | 'offline'; attempt?: number };

export interface ChatCore {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(c: string): Promise<void>;
  unsubscribe(c: string): Promise<void>;
  sendMessage(c: string, content: string): Promise<{ id: string }>;
  editMessage(id: string, content: string): Promise<{ id: string }>;
  deleteMessage(id: string): Promise<{ id: string }>;
  listMessages(c: string, opts?: { limit?: number; before?: number }): Promise<ChatMessage[]>;
  markRead(c: string, seq: number): Promise<void>;
  searchMessages(q: string, opts?: { channelId?: string; limit?: number }): Promise<ChatMessage[]>;
  publishTyping(c: string, untilMs: number): Promise<void>;
  onMessage(cb: (m: ChatMessage) => void): () => void;
  onPresence(cb: (p: PresenceEntry) => void): () => void;
  onTyping(cb: (t: TypingEntry) => void): () => void;
  onStatus(cb: (s: ChatCoreStatus) => void): () => void;
  pendingCount(): Promise<number>;
  flushOutbox(): Promise<void>;
  /** Releases the native handle. Call after `stop()`; later calls reject. */
  dispose(): void;
}

export function createChatCore(options: ChatCoreOptions): ChatCore;

export class ChatCoreUnavailableError extends Error {}
