/**
 * Optional craft-exec port. When the native sidecar is up, supervisor
 * installs a port that speaks `exec:run`. handleHostBash falls back to
 * local spawn if the port is unset or the invoke fails.
 */
export interface HostBashExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface HostBashExecRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  workspaceRoot?: string;
}

export type HostBashPort = (req: HostBashExecRequest) => Promise<HostBashExecResult>;

let port: HostBashPort | null = null;

export function setHostBashPort(next: HostBashPort | null): void {
  port = next;
}

export function getHostBashPort(): HostBashPort | null {
  return port;
}
