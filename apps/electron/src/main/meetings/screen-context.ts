import { bindSurfaceContext, type SurfaceContextInput } from '@craft-agent/core/rox2'

export function selectedScreenContext(input: SurfaceContextInput & { previewSurfaceId: string }) {
  if (input.surfaceId !== input.previewSurfaceId) {
    throw new Error('screen scope mismatch')
  }
  return bindSurfaceContext(input)
}
