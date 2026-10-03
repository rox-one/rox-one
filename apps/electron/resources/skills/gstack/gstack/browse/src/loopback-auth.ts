/** ROX: configuration values must not change the literal loopback URL host. */
export function isLoopbackPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535;
}
export function isDaemonState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return isLoopbackPort(state.port) && typeof state.token === 'string' && state.token.length > 0 && state.token.length <= 4096
    && !/[\r\n\u0000]/.test(state.token) && typeof state.pid === 'number' && Number.isInteger(state.pid) && state.pid > 0;
}
