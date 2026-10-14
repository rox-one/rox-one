/**
 * Cell-output text shaping (wave 9).
 *
 * A notebook cell that renders a progress bar (`tqdm`, `pip`, `curl`) rewrites
 * the same console line with `\r` instead of emitting a new one. Rendered
 * verbatim in a `<pre>`, every intermediate frame survives and the block fills
 * with garbage; a terminal keeps only what follows the last carriage return.
 * `normalizeOutputText` is that terminal rule, applied to a whole stream:
 *
 * 1. `\r\n` is a line ending, never a carriage return — it collapses to `\n`;
 * 2. in every remaining line, only the fragment after the last `\r` is kept.
 *
 * Pure and synchronous: the page calls it on the exact string it renders, so
 * what a cell shows is always the same string the utility would return.
 */

/** Normalize one console stream for display: no `\r` survives, `\r\n` is a break. */
export function normalizeOutputText(text: string): string {
  if (!text.includes('\r')) return text
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const carriageReturn = line.lastIndexOf('\r')
      return carriageReturn === -1 ? line : line.slice(carriageReturn + 1)
    })
    .join('\n')
}
