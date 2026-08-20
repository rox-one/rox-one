export type NativeSidecarHealthTone = 'ok' | 'fail' | 'off'

export interface NativeSidecarHealthView {
  tone: NativeSidecarHealthTone
  detail: string
}

export function nativeSidecarHealthView(
  checks: Array<{ name: string; status: string; message?: string }> | undefined,
): NativeSidecarHealthView {
  const check = checks?.find((item) => item.name === 'native_sidecar')
  if (!check) {
    return { tone: 'off', detail: 'disabled' }
  }
  const detail = check.message?.trim() || check.status
  if (check.status === 'fail') {
    return { tone: 'fail', detail }
  }
  if (detail.toLowerCase().includes('disabled')) {
    return { tone: 'off', detail }
  }
  return { tone: 'ok', detail }
}
