/**
 * Preload must stay an IPC/WS bridge. Heavy model/diagram SDKs that leak in
 * through shared barrels (pi-ai, Google GenAI, mermaid/elk) are aliased here so
 * a future barrel re-export cannot inflate bootstrap-preload.cjs again.
 * Attempts to use them fail at call time.
 */
export function unavailable(..._args: unknown[]): never {
  throw new Error('This dependency is unavailable in the Electron preload')
}

export default new Proxy(
  {},
  {
    get() {
      return unavailable
    },
  },
)
