/**
 * Minimal worker around `renderMaterialEffectPixels`: receive
 * `{ id, params }`, rasterise off the main thread, post `{ id, buffer }` back
 * with the RGBA buffer transferred. Not wired into the renderer yet — the
 * module is self-contained so it can be pointed at a `?worker` import later.
 */
import { renderMaterialEffectPixels, type MaterialEffectParams } from './material-effect-art'

interface MaterialEffectRequest {
  id: number
  params: MaterialEffectParams
}

interface MaterialEffectResponse {
  id: number
  buffer: ArrayBuffer
}

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<MaterialEffectRequest>) => void) => void
  postMessage: (message: MaterialEffectResponse, transfer: Transferable[]) => void
}

scope.addEventListener('message', (event) => {
  const { id, params } = event.data
  const buffer = renderMaterialEffectPixels(params).buffer as ArrayBuffer
  scope.postMessage({ id, buffer }, [buffer])
})