/**
 * Renderer stub for bash-parser. The real CJS package has no ESM default export
 * and pulls iterable-transform-replace. Explore-mode validation runs in main.
 */
export default function bashParser(_command: string): { type: 'Script'; commands: unknown[] } {
  return { type: 'Script', commands: [] }
}
