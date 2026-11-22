/**
 * Rox Cloud price list.
 *
 * One table of machines and two prices for each: the full retail price when
 * Rox pays the provider (managed) and the service fee when the customer brings
 * their own provider key (byok). Money is integer cents per hour everywhere;
 * no floats survive a calculation, so a rounding step can never invent a cent.
 *
 * The formula, straight from the product spec:
 *
 *   retail = 10 + 6×cpu + 3×memoryGb + 0.2×diskGb + gpuCents(type, count)
 *
 * rounded up to a whole cent. The 0.2×disk term is evaluated in fifths of a
 * cent (`diskGb / 5`), because `0.2 * 50` in binary floating point is
 * 10.000000000000002 and rounding that up would charge 57 instead of 56.
 */

/** One machine the price list sells; `snapshot` is what Daytona boots. */
export interface CloudMachineProduct {
  /** Stable id used by the site, the console and the API. */
  readonly id: string
  /** The word a customer sees. */
  readonly name: string
  /** Daytona snapshot that carries exactly these resources. */
  readonly snapshot: string
  readonly os: 'linux' | 'windows'
  readonly cpu: number
  readonly memoryGb: number
  readonly diskGb: number
  /** GPU that comes with the snapshot; absent means a CPU-only machine. */
  readonly gpu?: { readonly type: string; readonly count: number }
  /** Full retail price in integer cents per hour. */
  readonly centsPerHour: number
  /**
   * Whether this account can actually boot the product right now. A product
   * stays in the table when the vendor blocks it (no Windows class, no GPU
   * credits), so the site can sell the shape honestly instead of hiding it.
   */
  readonly available?: boolean
  /** Why an unavailable product cannot launch; shown next to the price. */
  readonly note?: string
}

/** What a machine's size looks like to the price list. */
export interface MachineShape {
  readonly cpu: number
  readonly memoryGb: number
  readonly diskGb?: number
  /** Total GPU cents per hour for this machine, from `gpuCentsPerHour`. */
  readonly gpu?: number
}

/** Cents per hour one card of a known model adds, `perCard`. */
const GPU_CENTS_PER_CARD: Readonly<Record<string, number>> = {
  h100: 300,
  l4: 90,
  a10: 120,
  t4: 60,
}

/** An unknown or missing model is priced like the middle card, never free. */
const UNKNOWN_GPU_CENTS_PER_CARD = 120

/** Base price of any machine: the ten cents every started hour costs. */
const BASE_CENTS = 10
/** Per-CPU and per-GiB-RAM terms. */
const CPU_CENTS = 6
const MEMORY_GB_CENTS = 3
/** Scratch disk is a fifth of a cent per GiB: five GiB per cent. */
const DISK_GB_PER_CENT = 5

/** The smallest fee Rox charges when the customer pays the provider itself. */
export const MIN_SERVICE_FEE_CENTS_PER_HOUR = 5
/** Rox's share of a managed hour: 15 % of retail, rounded to a cent. */
const SERVICE_FEE_RATE = 0.15

/**
 * The eight products in the spec's table. Every price here is recomputed by
 * `retailCentsPerHour` in the test suite, so the table and the formula cannot
 * drift apart unnoticed.
 */
export const DEFAULT_PRODUCTS: readonly CloudMachineProduct[] = [
  {
    id: 'linux-start',
    name: 'Мини',
    snapshot: 'daytonaio/sandbox:0.11.0',
    os: 'linux',
    cpu: 1,
    memoryGb: 1,
    diskGb: 3,
    centsPerHour: 20,
    available: true,
  },
  {
    id: 'linux-pro',
    name: 'Стандарт',
    snapshot: 'rox-cloud-medium-2x4',
    os: 'linux',
    cpu: 2,
    memoryGb: 4,
    diskGb: 8,
    centsPerHour: 36,
    available: true,
  },
  {
    id: 'linux-large',
    name: 'Про',
    snapshot: 'rox-cloud-large-4x8',
    os: 'linux',
    cpu: 4,
    memoryGb: 8,
    diskGb: 10,
    centsPerHour: 60,
    available: true,
  },
  {
    id: 'windows-start',
    name: 'Windows · 1 CPU',
    snapshot: 'windows-small',
    os: 'windows',
    cpu: 1,
    memoryGb: 4,
    diskGb: 30,
    centsPerHour: 34,
    available: false,
    note: 'Скоро: Windows пока не подключён',
  },
  {
    id: 'windows-pro',
    name: 'Windows · 2 CPU',
    snapshot: 'windows-medium',
    os: 'windows',
    cpu: 2,
    memoryGb: 8,
    diskGb: 50,
    centsPerHour: 56,
    available: false,
    note: 'Скоро: Windows пока не подключён',
  },
  {
    id: 'windows-large',
    name: 'Windows · 4 CPU',
    snapshot: 'windows-large',
    os: 'windows',
    cpu: 4,
    memoryGb: 16,
    diskGb: 50,
    centsPerHour: 92,
    available: false,
    note: 'Скоро: Windows пока не подключён',
  },
  {
    id: 'windows-xl',
    name: 'Windows · 8 CPU',
    snapshot: 'windows-xlarge',
    os: 'windows',
    cpu: 8,
    memoryGb: 32,
    diskGb: 100,
    centsPerHour: 174,
    available: false,
    note: 'Скоро: Windows пока не подключён',
  },
  {
    id: 'gpu-h100',
    name: 'H100',
    snapshot: 'daytona-gpu',
    os: 'linux',
    cpu: 16,
    memoryGb: 100,
    diskGb: 400,
    gpu: { type: 'h100', count: 1 },
    centsPerHour: 786,
    available: false,
    note: 'Скоро: GPU по запросу',
  },
]

/** One product by id, or `undefined` for an id this build does not sell. */
export function findProduct(id: string): CloudMachineProduct | undefined {
  return DEFAULT_PRODUCTS.find((product) => product.id === id)
}

/**
 * Cents per hour for the video cards alone.
 *
 * `count` defaults to one; a card of an unknown model costs the same as an
 * A10, so a typo in a snapshot's GPU name never makes a machine free.
 */
export function gpuCentsPerHour(type: string, count = 1): number {
  const perCard = GPU_CENTS_PER_CARD[type.trim().toLowerCase()] ?? UNKNOWN_GPU_CENTS_PER_CARD
  const cards = Number.isFinite(count) && count > 0 ? Math.ceil(count) : 1
  return perCard * cards
}

/**
 * Full retail price of a machine in integer cents per hour, rounded up.
 * `gpu` is the machine's total GPU cents, not a model name.
 */
export function retailCentsPerHour(shape: MachineShape): number {
  const diskGb = shape.diskGb !== undefined && shape.diskGb > 0 ? shape.diskGb : 0
  // Everything is counted in fifths of a cent, then rounded up once.
  const fifths =
    BASE_CENTS * 5 +
    CPU_CENTS * 5 * shape.cpu +
    MEMORY_GB_CENTS * 5 * shape.memoryGb +
    diskGb +
    (shape.gpu ?? 0) * 5
  return Math.ceil(fifths / 5)
}

/**
 * What Rox charges per hour when the customer pays the provider directly:
 * 15 % of retail, but never less than five cents.
 */
export function serviceFeeCentsPerHour(retailCents: number): number {
  if (!Number.isFinite(retailCents) || retailCents <= 0) return MIN_SERVICE_FEE_CENTS_PER_HOUR
  return Math.max(MIN_SERVICE_FEE_CENTS_PER_HOUR, Math.round(retailCents * SERVICE_FEE_RATE))
}

/**
 * Money as a person reads it: `2000` → `20,00 $`.
 *
 * The sign stays in front of the number and the decimal separator is a comma,
 * so the same string fits a Russian table and a plain-text invoice.
 */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents)
  const sign = rounded < 0 ? '−' : ''
  const absolute = Math.abs(rounded)
  const whole = Math.floor(absolute / 100)
  const rest = String(absolute % 100).padStart(2, '0')
  return `${sign}${whole},${rest} $`
}
