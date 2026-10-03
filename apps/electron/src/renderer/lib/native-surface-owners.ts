import type { NativeBoundsRect } from './native-surface-visibility'

type SyncNativeSurface = (instanceId: string, rect: NativeBoundsRect | null) => Promise<unknown>
interface Owner {
  rect: NativeBoundsRect | null
  order: number
  sync: SyncNativeSurface
}
interface Surface {
  owners: Map<symbol, Owner>
  lastSignature?: string
  sync: SyncNativeSurface
  pending: { rect: NativeBoundsRect | null; signature: string; sync: SyncNativeSurface } | null
  inFlight: boolean
  waiters: Array<() => void>
}

/**
 * Durable SiYuan/extension instances can have several renderer hosts. A hidden
 * owner's null rect must not erase another visible owner's current placement.
 * This does not clone a native view: the most recently revealed owner holds it.
 */
export function createNativeSurfaceOwners() {
  const surfaces = new Map<string, Surface>()
  let order = 0
  const makeSurface = (sync: SyncNativeSurface): Surface => ({ owners: new Map(), sync, pending: null, inFlight: false, waiters: [] })
  const settled = (surface: Surface): Promise<void> => {
    if (!surface.inFlight && !surface.pending) return Promise.resolve()
    return new Promise(resolve => surface.waiters.push(resolve))
  }
  const drain = (instanceId: string, surface: Surface): void => {
    if (surface.inFlight) return
    const next = surface.pending
    surface.pending = null
    if (!next || next.signature === surface.lastSignature) {
      for (const resolve of surface.waiters.splice(0)) resolve()
      if (surface.owners.size === 0) surfaces.delete(instanceId)
      return
    }
    surface.inFlight = true
    let request: Promise<unknown>
    try {
      request = next.sync(instanceId, next.rect)
    } catch (error) {
      request = Promise.reject(error)
    }
    void request.then(
      () => { surface.lastSignature = next.signature },
      () => {
        // An unacknowledged rect is retryable on the next invalidation. Do not
        // schedule a retry by ourselves or assume a rejected request applied.
        surface.lastSignature = undefined
      },
    ).then(() => {
      surface.inFlight = false
      drain(instanceId, surface)
    })
  }
  const enqueue = (instanceId: string, surface: Surface, rect: NativeBoundsRect | null, sync: SyncNativeSurface) => {
    // Coalesce intermediate geometry while a request is outstanding. A final
    // hide follows that request and cannot be overtaken by an older update.
    surface.pending = { rect, signature: JSON.stringify(rect), sync }
    drain(instanceId, surface)
  }
  const syncSurface = (instanceId: string, surface: Surface) => {
    const visible = [...surface.owners.values()]
      .filter(owner => owner.rect !== null)
      .sort((a, b) => b.order - a.order)[0]
    const rect = visible?.rect ?? null
    const sync = visible?.sync ?? surface.sync
    surface.sync = sync
    enqueue(instanceId, surface, rect, sync)
  }
  return {
    acquire(instanceId: string, sync: SyncNativeSurface) {
      const surface = surfaces.get(instanceId) ?? makeSurface(sync)
      surfaces.set(instanceId, surface)
      const id = Symbol(instanceId)
      const owner: Owner = { rect: null, order: ++order, sync }
      surface.owners.set(id, owner)
      let released = false
      return {
        update(rect: NativeBoundsRect | null) {
          if (released) return
          if (owner.rect === null && rect !== null) owner.order = ++order
          owner.rect = rect
          syncSurface(instanceId, surface)
        },
        release(): Promise<void> {
          if (released) return settled(surface)
          released = true
          surface.owners.delete(id)
          syncSurface(instanceId, surface)
          return settled(surface)
        },
      }
    },
    hideUnowned(instanceId: string, sync: SyncNativeSurface): Promise<void> {
      const surface = surfaces.get(instanceId) ?? makeSurface(sync)
      if (surface && [...surface.owners.values()].some(owner => owner.rect !== null)) return Promise.resolve()
      surfaces.set(instanceId, surface)
      enqueue(instanceId, surface, null, sync)
      return settled(surface)
    },
    whenSettled(instanceId: string): Promise<void> {
      const surface = surfaces.get(instanceId)
      return surface ? settled(surface) : Promise.resolve()
    },
  }
}

export const nativeSurfaceOwners = createNativeSurfaceOwners()

/** Async inspector attachment can finish after close: release only the claimed id. */
export function createNativeSurfaceLifetime(hide: (instanceId: string) => void) {
  let current: string | null = null
  let released = false
  return {
    claim(instanceId: string): boolean {
      if (released) {
        hide(instanceId)
        return false
      }
      if (current && current !== instanceId) hide(current)
      current = instanceId
      return true
    },
    release() {
      if (released) return
      released = true
      if (current) hide(current)
      current = null
    },
  }
}
