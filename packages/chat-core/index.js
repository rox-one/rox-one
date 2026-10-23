/**
 * @rox/chat-core — loader for the native chat core.
 *
 * Part of the Rox native chat client. Portions derived from Block's Buzz
 * (https://github.com/block/buzz), Apache-2.0 — see NOTICE at the repo root.
 *
 * The implementation lives in Rust (`native/crates/rox-chat-core`) and is
 * exposed through napi-rs. This module only locates the compiled addon; it
 * deliberately holds no protocol logic.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ADDON_FILE = 'rox-chat-core.node';
const BUILD_HINT =
  'build it with `cargo build -p rox-chat-core --features napi-bindings` (see packages/chat-core/README.md)';

/**
 * Thrown when the platform-specific native addon is missing or incomplete.
 */
export class ChatCoreUnavailableError extends Error {
  constructor(message, options) {
    super(
      message ??
        `The native @rox/chat-core addon (${ADDON_FILE}) is not available on this platform — ${BUILD_HINT}.`,
      options,
    );
    this.name = 'ChatCoreUnavailableError';
    this.code = 'CHAT_CORE_UNAVAILABLE';
  }
}

let nativeModule = null;

function loadNative() {
  if (nativeModule !== null) return nativeModule;

  let binding;
  try {
    binding = require(`./${ADDON_FILE}`);
  } catch (cause) {
    throw new ChatCoreUnavailableError(
      `Failed to load the native @rox/chat-core addon (${ADDON_FILE}) — ${BUILD_HINT}.`,
      { cause },
    );
  }

  if (binding === null || typeof binding.chatCoreCreate !== 'function') {
    throw new ChatCoreUnavailableError(
      `The native @rox/chat-core addon (${ADDON_FILE}) does not export chatCoreCreate — ${BUILD_HINT}.`,
    );
  }

  nativeModule = binding;
  return nativeModule;
}

/**
 * Create a chat core bound to a relay, a local cache file and a relay key.
 *
 * Throws {@link ChatCoreUnavailableError} when the native addon is not built.
 */
export function createChatCore(options) {
  const native = loadNative();
  const handle = native.chatCoreCreate(options);
  let disposed = false;
  const listen = (register, callback) => {
    const id = register(handle, callback);
    let active = true;
    return () => {
      if (!active || disposed) return;
      active = false;
      native.chatCoreOff(handle, id);
    };
  };

  // The addon exposes free functions over an opaque numeric handle (no napi
  // class, so no raw native pointer is ever unwrapped from a JS object). This
  // object re-creates the `ChatCore` surface declared in index.d.ts.
  return {
    start: () => native.chatCoreStart(handle),
    stop: () => native.chatCoreStop(handle),
    subscribe: (channel) => native.chatCoreSubscribe(handle, channel),
    unsubscribe: (channel) => native.chatCoreUnsubscribe(handle, channel),
    sendMessage: (channel, content) => native.chatCoreSendMessage(handle, channel, content),
    editMessage: (id, content) => native.chatCoreEditMessage(handle, id, content),
    deleteMessage: (id) => native.chatCoreDeleteMessage(handle, id),
    listMessages: (channel, opts) => native.chatCoreListMessages(handle, channel, opts),
    markRead: (channel, seq) => native.chatCoreMarkRead(handle, channel, seq),
    searchMessages: (query, opts) => native.chatCoreSearchMessages(handle, query, opts),
    publishTyping: (channel, untilMs) => native.chatCorePublishTyping(handle, channel, untilMs),
    onMessage: (callback) => listen(native.chatCoreOnMessage, callback),
    onPresence: (callback) => listen(native.chatCoreOnPresence, callback),
    onTyping: (callback) => listen(native.chatCoreOnTyping, callback),
    onStatus: (callback) => listen(native.chatCoreOnStatus, callback),
    pendingCount: () => native.chatCorePendingCount(handle),
    flushOutbox: () => native.chatCoreFlushOutbox(handle),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      native.chatCoreDispose(handle);
    },
  };
}

export default createChatCore;
