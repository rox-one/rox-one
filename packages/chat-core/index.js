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

  if (binding === null || typeof binding.createChatCore !== 'function') {
    throw new ChatCoreUnavailableError(
      `The native @rox/chat-core addon (${ADDON_FILE}) does not export createChatCore — ${BUILD_HINT}.`,
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
  return loadNative().createChatCore(options);
}

export default createChatCore;
