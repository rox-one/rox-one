/**
 * stdin EOF must not kill a live Pi JSONL server (S3-09).
 * Operators who want the old "pipe closed → exit" behaviour opt in.
 */
export function shouldShutdownOnStdinClose(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ROX_SHUTDOWN_ON_STDIN_CLOSE === '1';
}
