/**
 * The price list as the public site reads it.
 *
 * Every number comes from `@pricing`: the retail price is recomputed from the
 * machine's shape (never copied from a hard-coded string), and the service fee
 * is the same function the API uses when a customer brings their own provider
 * key. Availability and the human note also come from the price list, so the
 * site cannot sell a launch the provider will refuse.
 */
import {
  DEFAULT_PRODUCTS,
  gpuCentsPerHour,
  retailCentsPerHour,
  serviceFeeCentsPerHour,
} from '@pricing'
import type { CloudMachineProduct } from '@pricing'

export interface SiteProduct extends CloudMachineProduct {
  /** Full price of one hour on the platform key, in cents. */
  readonly retail: number
  /** What the wallet pays per hour with the customer's own provider key. */
  readonly fee: number
  /** Whether this configuration can actually boot right now. */
  readonly available: boolean
  /** Provider-side reason or caveat, copied from the price list's `note`. */
  readonly providerNote?: string
  /** A human label such as «Снимок Rox · 2×4», never the raw snapshot id. */
  readonly snapshotLabel: string
}

/** The region every available machine boots in, confirmed on a live run. */
export const LIVE_REGION = 'us'

/** Daytona's dashboard, where the wallet and provider quotas live. */
export const DAYTONA_CONSOLE_URL = 'https://app.daytona.io/'

const GPU_NAMES: Readonly<Record<string, string>> = {
  h100: 'H100',
  l4: 'L4',
  a10: 'A10',
  t4: 'T4',
}

/** `{type:'h100',count:1}` → `H100`; two cards read `2 × H100`. */
export function gpuText(gpu: { readonly type: string; readonly count: number }): string {
  const name = GPU_NAMES[gpu.type.trim().toLowerCase()] ?? gpu.type.toUpperCase()
  return gpu.count > 1 ? `${gpu.count} × ${name}` : name
}

interface SiteAvailability {
  readonly available: boolean
  readonly note?: string
}

/**
 * `available` and `note` belong to the price list in the same change. Reading
 * them through `in` keeps the site correct if a build briefly pairs it with an
 * older table: only the Linux machines without a GPU were live then, too.
 */
function readAvailability(product: CloudMachineProduct): SiteAvailability {
  const availableRaw: unknown = 'available' in product ? product.available : undefined
  const noteRaw: unknown = 'note' in product ? product.note : undefined
  const liveToday = product.os === 'linux' && product.gpu === undefined
  return {
    available: typeof availableRaw === 'boolean' ? availableRaw : liveToday,
    ...(typeof noteRaw === 'string' && noteRaw.trim().length > 0 ? { note: noteRaw } : {}),
  }
}

/**
 * The human name of the snapshot a machine boots: «Снимок Rox · 2×4», not
 * `rox-cloud-medium-2x4`. The family is read from the id so a rename cannot
 * silently claim Rox when the base Daytona image is used.
 */
function snapshotLabelFor(product: CloudMachineProduct): string {
  const size = `${product.cpu}×${product.memoryGb}`
  const family = product.snapshot.startsWith('rox-cloud')
    ? 'Rox'
    : product.snapshot.startsWith('daytonaio/') || product.snapshot.startsWith('daytona-')
      ? 'Daytona'
      : product.os === 'windows'
        ? 'Windows'
        : 'Rox'
  const gpuPart = product.gpu === undefined ? '' : ` · ${gpuText(product.gpu)}`
  return `Снимок ${family} · ${size}${gpuPart}`
}

/** The eight products with both prices, availability and a label resolved once. */
export const SITE_PRODUCTS: readonly SiteProduct[] = DEFAULT_PRODUCTS.map((product) => {
  const gpuCents = product.gpu ? gpuCentsPerHour(product.gpu.type, product.gpu.count) : 0
  const retail = retailCentsPerHour({
    cpu: product.cpu,
    memoryGb: product.memoryGb,
    diskGb: product.diskGb,
    gpu: gpuCents,
  })
  const availability = readAvailability(product)
  return {
    ...product,
    retail,
    fee: serviceFeeCentsPerHour(retail),
    available: availability.available,
    ...(availability.note === undefined ? {} : { providerNote: availability.note }),
    snapshotLabel: snapshotLabelFor(product),
  }
})

/** The configurations a customer can buy and boot right now. */
export const AVAILABLE_PRODUCTS: readonly SiteProduct[] = SITE_PRODUCTS.filter(
  (product) => product.available,
)

/** The configurations whose specs and price stay visible but need a request. */
export const REQUEST_PRODUCTS: readonly SiteProduct[] = SITE_PRODUCTS.filter(
  (product) => !product.available,
)

/** Russian plural: `1 ядро`, `2 ядра`, `8 ядер`. */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count) % 100
  const last = absolute % 10
  if (absolute > 10 && absolute < 20) return forms[2]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}

export function cpuText(cpu: number): string {
  return `${cpu} ${pluralRu(cpu, ['ядро', 'ядра', 'ядер'])}`
}

export function memoryText(gb: number): string {
  return `${gb} ГБ памяти`
}

export function diskText(gb: number): string {
  return `${gb} ГБ диска`
}

/** The trial balance, straight from the spec: 2000 cents. */
export const TRIAL_CENTS = 2000
