import { DEVICE_DIAGNOSTICS_CHANNELS, type DeviceDiagnosticsApi, type DeviceDiagnosticRequest } from '../shared/device-diagnostics'

/** Native bridge only; accepts no command, filesystem path, or workspace token. */
export function createDeviceDiagnosticsBridge(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): DeviceDiagnosticsApi {
  return Object.freeze({
    read: (request: DeviceDiagnosticRequest) => invoke(DEVICE_DIAGNOSTICS_CHANNELS.READ, {
      requestId: request.requestId,
      kind: request.kind,
      ...(request.source ? { source: request.source } : {}),
    }) as ReturnType<DeviceDiagnosticsApi['read']>,
    cancel: async (requestId: string) => { await invoke(DEVICE_DIAGNOSTICS_CHANNELS.CANCEL, requestId) },
  })
}
