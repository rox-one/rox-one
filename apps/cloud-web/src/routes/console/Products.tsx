import { A, useNavigate, useSearchParams } from '@solidjs/router'
import { DEFAULT_PRODUCTS, gpuCentsPerHour, retailCentsPerHour, serviceFeeCentsPerHour } from '@pricing'
import type { CloudMachineProduct } from '@pricing'
import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js'
import type { JSX } from 'solid-js'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  Select,
  useToast,
} from '@/components'
import type { BadgeTone } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { Catalog, GpuSpec, ProviderImage } from '@/lib/api'
import { formatCents, formatMoney, shortId } from '@/lib/format'

import { RollingText } from './components/RollingText'
import { Stepper } from './components/Stepper'
import { useConsoleSession } from './components/console-session'
import { errorText, gpuName, ttlLabel } from './components/console-ui'

import './products.css'

type GroupId = 'linux' | 'windows' | 'gpu'

/** Groups run Linux → Windows → GPU; rows inside a group run large to small. */
const GROUPS: readonly { id: GroupId; label: string; hint: string }[] = [
  { id: 'linux', label: 'Linux', hint: 'Сервер и разработка' },
  { id: 'windows', label: 'Windows', hint: 'Рабочий стол' },
  { id: 'gpu', label: 'GPU', hint: 'С видеокартой' },
]

const KNOWN_REGIONS: Record<string, string> = {
  us: 'США, Запад 1',
  'us-west-4': 'США, Запад 4',
}

/** Shown only when the catalog cannot answer: two regions from the live API. */
const FALLBACK_REGIONS: readonly string[] = ['us', 'us-west-4']

const TTL_OPTIONS: readonly number[] = [900, 1800, 3600, 7200, 14400, 28800, 86400]

/** One bootable image as the page works with it; presets are images too. */
interface MachineImage {
  id: string
  name: string
  label: string
  os: string
  cpu: number
  memoryGb: number
  diskGb?: number
  gpu: GpuSpec | null
  /** True when the row comes from the local catalog, not the live list. */
  fallback: boolean
  custom?: boolean
  /** `false` only when the price list says this snapshot cannot boot now. */
  available?: boolean
  /** The price list's own words for why a product is not bootable yet. */
  note?: string
}

/** The price list plus the flags it now carries for unavailable snapshots. */
type SellableProduct = CloudMachineProduct & {
  readonly available?: boolean
  readonly note?: string
}

const PRODUCTS: readonly SellableProduct[] = DEFAULT_PRODUCTS

/** One row of the catalog: a price-list product or a live snapshot beside it. */
interface OptionRow {
  key: string
  name: string
  image: MachineImage
  group: GroupId
  /** «Linux», «Windows» or «GPU» as the row's strip names the group. */
  groupLabel: string
  /** A named product of the price list, or a snapshot the list does not sell. */
  kind: 'product' | 'image'
  available: boolean
  note: string | null
  /** Cents per hour at the full price; the mode below decides the final rate. */
  price: number
}

/** The machine a row represents, whatever it is called; equal keys are one row. */
function shapeKey(image: MachineImage): string {
  const gpu = image.gpu === null ? '' : `${image.gpu.type.toLowerCase()}x${image.gpu.count}`
  return `${image.os}|${image.cpu}|${image.memoryGb}|${image.diskGb ?? ''}|${gpu}`
}

/** The same machine without the disk a live listing may leave out. */
function sizeKey(image: MachineImage): string {
  const gpu = image.gpu === null ? '' : `${image.gpu.type.toLowerCase()}x${image.gpu.count}`
  return `${image.os}|${image.cpu}|${image.memoryGb}|${gpu}`
}

function groupOf(image: { os?: string; gpu?: GpuSpec | null }): GroupId {
  if (image.gpu !== null && image.gpu !== undefined) return 'gpu'
  return image.os === 'windows' ? 'windows' : 'linux'
}

function presetImage(product: SellableProduct): MachineImage {
  const osName = product.os === 'windows' ? 'Windows' : 'Linux'
  return {
    id: product.snapshot,
    name: product.snapshot,
    label: `${osName} · ${product.name}`,
    os: product.os,
    cpu: product.cpu,
    memoryGb: product.memoryGb,
    diskGb: product.diskGb,
    gpu: product.gpu === undefined ? null : { type: product.gpu.type, count: product.gpu.count },
    fallback: true,
    available: product.available !== false,
    ...(product.note === undefined ? {} : { note: product.note }),
  }
}

function imageFromProvider(image: ProviderImage): MachineImage | undefined {
  const cpu = typeof image.cpu === 'number' ? image.cpu : 0
  const memoryGb = typeof image.memoryGb === 'number' ? image.memoryGb : 0
  if (cpu <= 0 || memoryGb <= 0) return undefined
  const name = image.name.length > 0 ? image.name : image.id
  const product = PRODUCTS.find((entry) => entry.snapshot === name)
  const broken = BROKEN_SNAPSHOTS[name]
  const note = broken ?? product?.note
  const label = image.label ?? name
  return {
    id: image.id,
    name,
    // A live label may still carry the upstream image owner; the customer sees
    // a Rox image and the size it carries, never the vendor's own name.
    label: /daytona/i.test(label) ? `Образ Rox · ${cpu}×${memoryGb}` : label,
    os: typeof image.os === 'string' && image.os.length > 0 ? image.os : 'linux',
    cpu,
    memoryGb,
    ...(typeof image.diskGb === 'number' && image.diskGb > 0 ? { diskGb: image.diskGb } : {}),
    gpu: image.gpu ?? null,
    fallback: false,
    available: broken === undefined && product?.available !== false,
    ...(note === undefined ? {} : { note }),
  }
}

const PRESET_IMAGES: readonly MachineImage[] = PRODUCTS.map(presetImage)

/** Live snapshots the platform knows are broken; presets never come from here. */
const BROKEN_SNAPSHOTS: Record<string, string> = {
  'daytona-small': 'Скоро: образ обновляется',
  'daytona-medium': 'Скоро: образ обновляется',
  'daytona-large': 'Скоро: образ обновляется',
}

/** A preset that would price this image the same way; only then it is safe to send `product`. */
function presetFor(image: MachineImage): SellableProduct | undefined {
  if (image.custom === true) return undefined
  return PRODUCTS.find(
    (product) =>
      product.snapshot === image.name &&
      product.cpu === image.cpu &&
      product.memoryGb === image.memoryGb &&
      image.diskGb === product.diskGb &&
      (product.gpu === undefined
        ? image.gpu === null
        : image.gpu !== null && image.gpu.type === product.gpu.type && image.gpu.count === product.gpu.count),
  )
}

function gpuCents(gpu: GpuSpec | null): number {
  return gpu === null ? 0 : gpuCentsPerHour(gpu.type, gpu.count)
}

/** A server message as a customer may read it: no upstream owner names. */
function customerText(message: string): string {
  return message.replace(/daytona/gi, 'Rox')
}

/** `2 CPU · 4 GB RAM · 8 GB SSD · 1×H100`, the machine as the customer reads it. */
function specLine(image: {
  cpu: number
  memoryGb: number
  diskGb?: number | undefined
  gpu: GpuSpec | null
}): string {
  const parts: string[] = [`${image.cpu} CPU`, `${image.memoryGb} GB RAM`]
  if (image.diskGb !== undefined && image.diskGb > 0) parts.push(`${image.diskGb} GB SSD`)
  const card = gpuName(image.gpu)
  if (card !== null) parts.push(card)
  return parts.join(' · ')
}

/** Full price of an hour for this image; a catalog product keeps its own number. */
function priceOf(image: MachineImage): number {
  const preset = presetFor(image)
  if (preset !== undefined) return preset.centsPerHour
  return retailCentsPerHour({
    cpu: image.cpu,
    memoryGb: image.memoryGb,
    diskGb: image.diskGb ?? 0,
    gpu: gpuCents(image.gpu),
  })
}

/**
 * Closest image to the requested numbers: processor first, then memory, then
 * disk. Ties prefer the smaller machine, so a click never silently upsells.
 */
function nearestImage(
  list: readonly MachineImage[],
  cpu: number,
  memoryGb: number,
  diskGb: number,
): MachineImage | undefined {
  const first = list[0]
  if (first === undefined) return undefined
  const distance = (image: MachineImage): number[] => [
    Math.abs(image.cpu - cpu),
    Math.abs(image.memoryGb - memoryGb),
    Math.abs((image.diskGb ?? diskGb) - diskGb),
    image.cpu,
  ]
  let best = first
  let bestScore = distance(first)
  for (const image of list) {
    const candidate = distance(image)
    let order = 0
    for (let index = 0; index < candidate.length && order === 0; index += 1) {
      order = (candidate[index] ?? 0) - (bestScore[index] ?? 0)
    }
    if (order < 0) {
      best = image
      bestScore = candidate
    }
  }
  return best
}

/** Large to small inside a group: a person scanning the list sees Про before Мини. */
function bySize(left: OptionRow, right: OptionRow): number {
  const a = left.image
  const b = right.image
  return (
    b.cpu - a.cpu ||
    b.memoryGb - a.memoryGb ||
    (b.diskGb ?? 0) - (a.diskGb ?? 0) ||
    left.name.localeCompare(right.name, 'ru')
  )
}

interface CatalogRowProps {
  row: OptionRow
  active: boolean
  onPick: (image: MachineImage) => void
}

/** One clickable catalog row; products and extra snapshots share it. */
function CatalogRow(props: CatalogRowProps): JSX.Element {
  return (
    <button
      type="button"
      class="cfg-option"
      classList={{ 'is-active': props.active }}
      aria-pressed={props.active ? 'true' : 'false'}
      onClick={() => props.onPick(props.row.image)}
    >
      <span class="cfg-option-main">
        <span class="cfg-option-name">{props.row.name}</span>
        <span class="cfg-option-spec">{specLine(props.row.image)}</span>
      </span>
      <span class="cfg-option-price">{formatMoney(props.row.price, { perHour: true })}</span>
    </button>
  )
}

interface LaunchBlock {
  text: string
  kind: 'platform' | 'topup' | 'account' | 'images' | 'wait' | 'unavailable'
}

interface LaunchFailure {
  message: string
  code: string | null
  requestId: string | null
}

export default function ConsoleProducts(): JSX.Element {
  const session = useConsoleSession()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()

  const initialPreset =
    PRODUCTS.find((product) => product.id === 'linux-pro' && product.available !== false) ??
    PRODUCTS.find((product) => product.available !== false) ??
    PRODUCTS[0]
  const initialImage = initialPreset === undefined ? PRESET_IMAGES[1] : presetImage(initialPreset)

  const [liveImages, setLiveImages] = createSignal<MachineImage[]>([])
  const [imagesState, setImagesState] = createSignal<'loading' | 'live' | 'fallback' | 'empty'>('loading')
  const [imagesFailure, setImagesFailure] = createSignal<string | null>(null)
  const [catalog, setCatalog] = createSignal<Catalog | undefined>(undefined)
  const [catalogFailure, setCatalogFailure] = createSignal<string | null>(null)
  const [ownKey, setOwnKey] = createSignal(false)
  const [credentialsChecked, setCredentialsChecked] = createSignal(false)
  const [credentialsFailure, setCredentialsFailure] = createSignal<string | null>(null)

  const [targetCpu, setTargetCpu] = createSignal(initialImage?.cpu ?? 2)
  const [targetMemory, setTargetMemory] = createSignal(initialImage?.memoryGb ?? 4)
  const [targetDisk, setTargetDisk] = createSignal(initialImage?.diskGb ?? 8)
  const [picked, setPicked] = createSignal<MachineImage | undefined>(initialImage)
  const [customName, setCustomName] = createSignal('')
  const [region, setRegion] = createSignal('')
  const [regionTouched, setRegionTouched] = createSignal(false)
  const [ttlSec, setTtlSec] = createSignal(3600)
  const [launching, setLaunching] = createSignal(false)
  const [launchError, setLaunchError] = createSignal<LaunchFailure | null>(null)
  const [planNote, setPlanNote] = createSignal<string | null>(null)

  const allImages = createMemo<MachineImage[]>(() =>
    imagesState() === 'live' ? liveImages() : [...PRESET_IMAGES],
  )

  const cpuLimit = createMemo(() => (session.guest() ? 16 : 32))

  /**
   * Every product in the price list as one catalog row, its live snapshot when
   * one matches by name and size, then live snapshots the list does not sell.
   */
  const rows = createMemo<OptionRow[]>(() => {
    const live = allImages().filter((image) => !image.fallback)
    const used = new Set<MachineImage>()
    const snapshots = new Set<string>()
    const shapes = new Set<string>()
    const sizes = new Set<string>()
    const list: OptionRow[] = []
    for (const product of PRODUCTS) {
      const preset = presetImage(product)
      const matched = live.find(
        (entry) =>
          !used.has(entry) &&
          entry.name === product.snapshot &&
          entry.cpu === product.cpu &&
          entry.memoryGb === product.memoryGb &&
          (entry.diskGb === undefined || entry.diskGb === product.diskGb),
      )
      const image = matched ?? preset
      if (matched !== undefined) used.add(matched)
      snapshots.add(product.snapshot)
      snapshots.add(image.name)
      // Both the catalog shape and the live shape count as taken, so a second
      // listing of the same machine never becomes a row of its own.
      shapes.add(shapeKey(preset))
      sizes.add(sizeKey(preset))
      if (matched !== undefined) {
        shapes.add(shapeKey(matched))
        sizes.add(sizeKey(matched))
      }
      const group = groupOf(product)
      list.push({
        key: product.id,
        name: product.name,
        image,
        group,
        groupLabel: GROUPS.find((entry) => entry.id === group)?.label ?? group,
        kind: 'product',
        available: image.available !== false,
        note: image.note ?? product.note ?? null,
        price: priceOf(image),
      })
    }
    for (const image of live) {
      // A live snapshot takes a row of its own only when neither its id, its
      // exact shape, nor the same size with an unlisted disk is already shown
      // under a product's own name.
      const known =
        used.has(image) ||
        snapshots.has(image.name) ||
        shapes.has(shapeKey(image)) ||
        (image.diskGb === undefined && sizes.has(sizeKey(image)))
      if (known) continue
      used.add(image)
      snapshots.add(image.name)
      shapes.add(shapeKey(image))
      sizes.add(sizeKey(image))
      const group = groupOf(image)
      list.push({
        key: `live:${image.id}`,
        name: image.label,
        image,
        group,
        groupLabel: GROUPS.find((entry) => entry.id === group)?.label ?? group,
        kind: 'image',
        available: image.available !== false,
        note: image.note ?? null,
        price: priceOf(image),
      })
    }
    return list.sort(bySize)
  })

  const groups = createMemo(() =>
    GROUPS.map((entry) => ({
      ...entry,
      rows: rows().filter(
        (row) =>
          row.kind === 'product' &&
          row.group === entry.id &&
          row.available &&
          row.image.cpu <= cpuLimit(),
      ),
    })),
  )

  /** Snapshots beyond the price list: real machines, kept apart from the names. */
  const extra = createMemo<OptionRow[]>(() =>
    rows().filter(
      (row) => row.kind === 'image' && row.available && row.image.cpu <= cpuLimit(),
    ),
  )

  /** Everything that cannot boot now, collapsed into one «Скоро» strip. */
  const soon = createMemo<OptionRow[]>(() => rows().filter((row) => !row.available))

  const bootable = createMemo<MachineImage[]>(() =>
    rows()
      .filter((row) => row.available && row.image.cpu <= cpuLimit())
      .map((row) => row.image),
  )

  const nearest = createMemo<MachineImage | undefined>(() =>
    nearestImage(bootable(), targetCpu(), targetMemory(), targetDisk()),
  )

  const selected = createMemo<MachineImage | undefined>(() => picked() ?? nearest())

  const exact = createMemo<boolean>(() => {
    const image = selected()
    if (image === undefined) return false
    return (
      image.cpu === targetCpu() &&
      image.memoryGb === targetMemory() &&
      (image.diskGb === undefined || image.diskGb === targetDisk())
    )
  })

  const chosenProduct = createMemo<SellableProduct | undefined>(() => {
    const image = selected()
    return image === undefined ? undefined : presetFor(image)
  })

  const chosenName = createMemo<string>(() => {
    const image = selected()
    if (image === undefined) return 'Машина не выбрана'
    return chosenProduct()?.name ?? image.label
  })

  const isActive = (image: MachineImage): boolean => {
    const current = selected()
    return (
      current !== undefined &&
      current.name === image.name &&
      current.cpu === image.cpu &&
      current.memoryGb === image.memoryGb
    )
  }

  const selectImage = (image: MachineImage): void => {
    setTargetCpu(image.cpu)
    setTargetMemory(image.memoryGb)
    setTargetDisk(image.diskGb ?? targetDisk())
    setPicked(image)
    setLaunchError(null)
  }

  const selectPreset = (product: SellableProduct): void => {
    if (product.available === false) {
      setPlanNote(product.note ?? 'Скоро: эта конфигурация пока не запускается.')
      return
    }
    const live = allImages().find(
      (image) =>
        image.name === product.snapshot &&
        image.cpu === product.cpu &&
        image.memoryGb === product.memoryGb &&
        image.diskGb === product.diskGb,
    )
    const image = live ?? presetImage(product)
    setTargetCpu(image.cpu)
    setTargetMemory(image.memoryGb)
    setTargetDisk(image.diskGb ?? product.diskGb)
    setPicked(image)
    setLaunchError(null)
    setPlanNote(null)
  }

  const applyCustom = (): void => {
    const name = customName().trim()
    if (name.length === 0) return
    setPicked({
      id: name,
      name,
      label: `Свой снимок ${name}`,
      os: 'linux',
      cpu: targetCpu(),
      memoryGb: targetMemory(),
      diskGb: targetDisk(),
      gpu: null,
      fallback: false,
      custom: true,
    })
    setLaunchError(null)
  }

  const loadImages = async (): Promise<void> => {
    setImagesState('loading')
    setImagesFailure(null)
    try {
      const listing = await api.providerImages('daytona')
      const mapped: MachineImage[] = []
      for (const entry of listing.data) {
        if (entry.state !== undefined && entry.state !== 'active') continue
        const image = imageFromProvider(entry)
        if (image !== undefined) mapped.push(image)
      }
      setLiveImages(mapped)
      setImagesState(mapped.length > 0 ? 'live' : 'empty')
      // A preset chosen a moment ago may now have a live row; use it only when
      // it carries the same size, so the displayed price stays the catalog one.
      const current = picked()
      if (current !== undefined && current.fallback) {
        const live = mapped.find(
          (image) =>
            image.name === current.name &&
            image.cpu === current.cpu &&
            image.memoryGb === current.memoryGb &&
            image.diskGb === current.diskGb,
        )
        if (live !== undefined) {
          setPicked(live)
          setTargetCpu(live.cpu)
          setTargetMemory(live.memoryGb)
          if (live.diskGb !== undefined) setTargetDisk(live.diskGb)
        }
      }
    } catch (err) {
      setLiveImages([])
      setImagesFailure(customerText(errorText(err)))
      setImagesState('fallback')
    }
  }

  const loadCatalog = async (): Promise<void> => {
    try {
      const catalogue = await api.catalog()
      setCatalog(catalogue)
      setCatalogFailure(null)
      // The working Rox snapshots live in `us`; choose it until a person says
      // otherwise, so the first launch does not ask for a region with no image.
      const provider = catalogue.providers?.find((entry) => entry.id === 'daytona')
      const regions = provider?.regions ?? []
      if (!regionTouched() && region().length === 0 && (regions.length === 0 || regions.includes('us'))) {
        setRegion('us')
      }
    } catch (err) {
      setCatalogFailure(customerText(errorText(err)))
      // Even without the catalog the known working region is `us`: leaving the
      // field empty would let the platform choose a region with no snapshot.
      if (!regionTouched() && region().length === 0) setRegion('us')
    }
  }

  const loadCredentials = async (): Promise<void> => {
    try {
      const listing = await api.credentials()
      const at = Date.now()
      setOwnKey(
        listing.data.some(
          (credential) =>
            credential.provider === 'daytona' &&
            credential.status === 'active' &&
            (credential.expires_at === undefined ||
              credential.expires_at === null ||
              Date.parse(credential.expires_at) > at),
        ),
      )
      setCredentialsFailure(null)
    } catch (err) {
      // A guest key cannot read private account data; a guest has none by definition.
      setOwnKey(false)
      setCredentialsFailure(errorText(err))
    } finally {
      setCredentialsChecked(true)
    }
  }

  onMount(() => {
    void loadImages()
    void loadCatalog()
    void loadCredentials()
  })

  // The site links here with `?plan=<code>`; a second link click while the
  // console is already open must still preselect the product it names.
  let appliedPlan = ''
  createEffect(() => {
    const plan = params.plan
    const code = Array.isArray(plan) ? plan[0] : plan
    if (typeof code !== 'string' || code.length === 0 || code === appliedPlan) return
    appliedPlan = code
    const product = PRODUCTS.find((entry) => entry.id === code)
    if (product === undefined) {
      setPlanNote(`Такой конфигурации в списке нет: соберите свою ниже.`)
      return
    }
    selectPreset(product)
  })

  const platformListed = createMemo<boolean>(() => {
    const catalogue = catalog()
    if (catalogue === undefined) return true
    return (catalogue.providers ?? []).some((provider) => provider.id === 'daytona')
  })

  const managedAvailable = createMemo<boolean>(() =>
    (catalog()?.managed_providers ?? []).includes('daytona'),
  )

  const regionOptions = createMemo(() => {
    const provider = catalog()?.providers?.find((entry) => entry.id === 'daytona')
    const ids = provider?.regions ?? []
    const list = ids.length > 0 ? ids : FALLBACK_REGIONS
    return [
      { value: '', label: 'Любая площадка' },
      ...list.map((id) => ({ value: id, label: KNOWN_REGIONS[id] ?? id })),
    ]
  })

  const regionText = createMemo<string>(() => {
    const current = region()
    if (current.length === 0) return 'Любая площадка'
    return KNOWN_REGIONS[current] ?? current
  })

  const regionNote = createMemo<string | null>(() => {
    if (catalog() === undefined) return null
    const provider = catalog()?.providers?.find((entry) => entry.id === 'daytona')
    if (provider !== undefined && (provider.regions?.length ?? 0) > 0) return null
    return 'Список площадок не пришёл: показаны известные — США (общая) и США (выделенная). Рабочие образы Rox лежат в США.'
  })

  const retail = createMemo<number>(() => {
    const image = selected()
    return image === undefined ? 0 : priceOf(image)
  })

  const rate = createMemo<number>(() =>
    ownKey() ? serviceFeeCentsPerHour(retail()) : retail(),
  )
  const hold = createMemo<number>(() => Math.ceil((ttlSec() / 3600) * rate() - 1e-9))
  const balance = createMemo<number | undefined>(() => session.account()?.balance_cents)
  const shortfall = createMemo<number>(() => {
    const current = balance()
    return current === undefined ? 0 : Math.max(0, hold() - current)
  })
  const after = createMemo<number | undefined>(() => {
    const current = balance()
    return current === undefined ? undefined : current - hold()
  })
  const capLeft = createMemo<number | undefined>(() => {
    const account = session.account()
    if (account === undefined || account.monthly_cap_cents <= 0) return undefined
    // The wallet counts the month's spend plus every live hold against the cap.
    return account.monthly_cap_cents - account.month_spent_cents - account.reserved_cents
  })

  const blocked = createMemo<LaunchBlock | null>(() => {
    const image = selected()
    if (image === undefined) {
      return { kind: 'images', text: 'Сейчас нечего запустить: обновите список конфигураций.' }
    }
    if (image.available === false) {
      return { kind: 'unavailable', text: image.note ?? 'Скоро: эта конфигурация пока не запускается.' }
    }
    if (!credentialsChecked()) {
      return { kind: 'wait', text: 'Считаем цену часа…' }
    }
    if (catalog() === undefined && catalogFailure() === null) {
      return { kind: 'wait', text: 'Проверяем площадки…' }
    }
    if (!platformListed()) {
      return { kind: 'platform', text: 'Запуск в этой сборке закрыт: площадка не подключена.' }
    }
    if (!ownKey() && catalog() !== undefined && !managedAvailable()) {
      return { kind: 'platform', text: 'Запуск пока закрыт: Rox подключает площадку по обращению.' }
    }
    const current = balance()
    if (current === undefined) {
      return {
        kind: 'account',
        text: session.accountLoading() ? 'Баланс загружается…' : 'Баланс не загрузился: счёт не отвечает.',
      }
    }
    if (shortfall() > 0) {
      return {
        kind: 'topup',
        text: `Не хватает ${formatCents(shortfall())}: резерв за ${ttlLabel(ttlSec())} не помещается в остаток.`,
      }
    }
    const left = capLeft()
    if (left !== undefined && hold() > left) {
      return {
        kind: 'topup',
        text: `Месячный потолок: свободно ${formatCents(left)}, а резерв ${formatCents(hold())}.`,
      }
    }
    return null
  })

  const mode = createMemo<{ label: string; tone: BadgeTone; hint: string }>(() => {
    if (!credentialsChecked()) {
      return { label: 'Считаем', tone: 'neutral', hint: 'Цена часа уточняется.' }
    }
    if (ownKey()) {
      return {
        label: 'Сервисный тариф',
        tone: 'success',
        hint: 'Железо оплачиваете напрямую, Rox берёт сервисный сбор за управление.',
      }
    }
    if (catalog() !== undefined && !managedAvailable()) {
      return {
        label: 'Запуск закрыт',
        tone: 'danger',
        hint: 'В этой сборке Rox ещё не подключил площадку для запуска.',
      }
    }
    if (credentialsFailure() !== null && !session.guest()) {
      return {
        label: 'Цена уточняется',
        tone: 'neutral',
        hint: 'Окончательную цену назовёт сервер при запуске.',
      }
    }
    return {
      label: 'Цена Rox',
      tone: 'accent',
      hint: session.guest()
        ? 'Пробный доступ: полная цена часа списывается с пробного баланса.'
        : 'Полная цена часа: машина целиком на стороне Rox.',
    }
  })

  const imagesSubtitle = (): string => {
    const state = imagesState()
    if (state === 'loading') return 'Обновляем список образов'
    if (state === 'live') return 'Только активные образы'
    if (state === 'empty') return 'Каталог Rox: активных образов нет'
    return 'Каталог Rox: список образов не пришёл'
  }

  /** A catalog preset whose live snapshot has drifted to another size. */
  const driftNote = createMemo<string | null>(() => {
    const image = picked()
    if (image === undefined || !image.fallback) return null
    const live = liveImages().find((entry) => entry.name === image.name)
    if (live === undefined) return null
    const sameSize =
      live.cpu === image.cpu &&
      live.memoryGb === image.memoryGb &&
      (live.diskGb === undefined || live.diskGb === image.diskGb)
    if (sameSize) return null
    return `${image.label} в облаке сейчас другого состава: ${specLine(live)}. Показан состав каталога, по которому считается цена; сверить фактический состав можно в терминале после запуска.`
  })

  const launch = async (): Promise<void> => {
    const image = selected()
    if (image === undefined || blocked() !== null || launching()) return
    setLaunching(true)
    setLaunchError(null)
    const preset = presetFor(image)
    const size = {
      os: image.os,
      cpu: image.cpu,
      memoryGb: image.memoryGb,
      ...(image.diskGb === undefined ? {} : { diskGb: image.diskGb }),
      ...(image.gpu === null ? {} : { gpu: { type: image.gpu.type, count: image.gpu.count } }),
      ...(region().length === 0 ? {} : { region: region() }),
      ttlSec: ttlSec(),
      provider: 'daytona',
    }
    try {
      const sandbox =
        preset === undefined
          ? await api.createSandbox({ snapshot: image.name, ...size })
          : await api.createSandbox({ product: preset.id, ...size })
      toast.success(`Машина ${shortId(sandbox.id)} запускается`)
      void session.refreshAccount()
      navigate(`/console/machines/${sandbox.id}`)
    } catch (err) {
      const failure = err instanceof ApiError ? err : null
      setLaunchError({
        message: customerText(errorText(err)),
        code: failure === null ? null : failure.code,
        requestId: failure === null ? null : failure.requestId,
      })
    } finally {
      setLaunching(false)
    }
  }

  const adjust = (set: (value: number) => void) => (value: number): void => {
    set(value)
    setPicked(undefined)
    setLaunchError(null)
  }

  return (
    <section class="page products-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Новая машина"
        description="Процессор, память и диск — одной строкой, цена часа пересчитывается сразу. Выбранная машина, площадка и запуск — в карточке справа."
        actions={
          <A href="/console/machines" class="btn btn-secondary btn-sm">
            Мои машины
          </A>
        }
      />

      <Show when={planNote()}>
        {(note) => <div class="console-note">{note()}</div>}
      </Show>

      <Card bodyClass="cfg-body">
        <div class="cfg-row">
          <div class="cfg-sliders">
            <Stepper
              id="cfg-cpu"
              label="Процессор"
              value={targetCpu()}
              unit="ядра"
              min={1}
              max={cpuLimit()}
              hint={session.guest() ? 'Гостю до 16 ядер' : undefined}
              onChange={adjust(setTargetCpu)}
            />
            <Stepper
              id="cfg-memory"
              label="Память"
              value={targetMemory()}
              unit="ГБ"
              min={1}
              max={128}
              onChange={adjust(setTargetMemory)}
            />
            <Stepper
              id="cfg-disk"
              label="Диск"
              value={targetDisk()}
              unit="ГБ"
              min={1}
              max={500}
              step={5}
              onChange={adjust(setTargetDisk)}
            />
          </div>
          <div class="cfg-price">
            <span class="cfg-price-label">Цена часа</span>
            <span class="cfg-price-value" aria-live="polite">
              {formatMoney(rate(), { perHour: true })}
            </span>
            <span class="cfg-price-note">
              резерв {formatCents(hold())} за {ttlLabel(ttlSec())}
            </span>
          </div>
        </div>
        <Show when={selected()}>
          {(image) => (
            <Show when={!exact()}>
              <p class="cfg-hint">
                Готового состава ровно под эти числа нет: запустим {specLine(image())}.
              </p>
            </Show>
          )}
        </Show>
      </Card>

      <div class="console-grid products-grid">
        <div class="console-col stack-lg">
          <Card
            title="Конфигурации"
            subtitle={imagesSubtitle()}
            actions={
              <Button
                size="sm"
                variant="ghost"
                loading={imagesState() === 'loading'}
                onClick={() => void loadImages()}
              >
                Обновить
              </Button>
            }
          >
            <div
              class="catalog-area"
              aria-busy={imagesState() === 'loading' ? 'true' : undefined}
            >
              <Show
                when={bootable().length > 0}
                fallback={
                  <EmptyState
                    icon="box"
                    title="Сейчас нет доступных конфигураций"
                    description="Windows и видеокарты появятся позже: они собраны в разделе «Скоро»."
                  />
                }
              >
                <For each={groups()}>
                  {(entry) => (
                    <Show when={entry.rows.length > 0}>
                      <div class="catalog-group">
                        <div class="catalog-head">
                          <span class="catalog-label">{entry.label}</span>
                          <span class="catalog-hint">{entry.hint}</span>
                        </div>
                        <div class="catalog-list" role="group" aria-label={`${entry.label}: доступные образы`}>
                          <For each={entry.rows}>
                            {(row) => (
                              <CatalogRow
                                row={row}
                                active={isActive(row.image)}
                                onPick={selectImage}
                              />
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  )}
                </For>

                <Show when={extra().length > 0}>
                  <div class="catalog-group">
                    <div class="catalog-head">
                      <span class="catalog-label">Другие образы</span>
                      <span class="catalog-hint">Снимки сверх каталога Rox</span>
                    </div>
                    <div class="catalog-list" role="group" aria-label="Другие образы">
                      <For each={extra()}>
                        {(row) => (
                          <CatalogRow
                            row={row}
                            active={isActive(row.image)}
                            onPick={selectImage}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Show>

              <Show when={soon().length > 0}>
                <details class="soon">
                  <summary class="soon-summary">
                    <span class="soon-title">Скоро</span>
                    <span class="soon-count">{soon().length}</span>
                    <span class="soon-hint">Windows и видеокарты — появятся позже</span>
                  </summary>
                  <div class="soon-list">
                    <For each={soon()}>
                      {(row) => (
                        <div class="soon-row">
                          <span class="soon-group">{row.groupLabel}</span>
                          <span class="soon-main">
                            <span class="soon-name">{row.name}</span>
                            <span class="soon-spec">{specLine(row.image)}</span>
                          </span>
                          <span class="soon-note">{row.note ?? 'Скоро'}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              </Show>

              <Show when={imagesState() === 'fallback'}>
                <div class="console-note" role="status">
                  Список образов не пришёл: {imagesFailure()}. Показан каталог Rox — состав и
                  цена точные, доступность проверит сервер при запуске.
                </div>
              </Show>
              <Show when={imagesState() === 'empty'}>
                <div class="console-note" role="status">
                  Активных образов сейчас нет. Показан каталог Rox: сервер откажет, если образа нет.
                </div>
              </Show>

              <Show when={driftNote()}>
                {(note) => (
                  <div class="console-note" role="status">
                    {note()}
                  </div>
                )}
              </Show>

              <div class="custom-snapshot">
                <Field
                  label="Свой снимок"
                  for="custom-snapshot"
                  hint="Имя вашего снимка. Ресурсы сервер проверит по снимку; при расхождении запуск остановится до резерва. Цена часа посчитана по ползункам выше."
                >
                  <div class="custom-row">
                    <input
                      id="custom-snapshot"
                      class="input"
                      value={customName()}
                      placeholder="my-snapshot"
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck={false}
                      onInput={(event) => setCustomName(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        applyCustom()
                      }}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={customName().trim().length === 0}
                      onClick={applyCustom}
                    >
                      Выбрать
                    </Button>
                  </div>
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <aside class="console-col console-summary">
          <Card title="Ваша машина" subtitle="Цена, площадка и запуск">
            <Show
              when={selected()}
              fallback={<div class="console-note">Машина не выбрана: выберите конфигурацию слева.</div>}
            >
              {(image) => (
                <div class="pick">
                  <div class="pick-head">
                    <span class="pick-name">{chosenName()}</span>
                    <Badge tone={exact() ? 'success' : 'warning'}>
                      {exact() ? 'Точный состав' : 'Ближайший'}
                    </Badge>
                  </div>
                  <div class="pick-spec">{specLine(image())}</div>
                  <div class="pick-foot">
                    <span class="pick-price">{formatMoney(rate(), { perHour: true })}</span>
                    <span class="pick-region">{regionText()}</span>
                  </div>
                </div>
              )}
            </Show>

            <div class="summary-mode">
              <Badge tone={mode().tone}>{mode().label}</Badge>
              <span class="summary-mode-text">{mode().hint}</span>
            </div>

            <div class="field">
              <span class="field-label" id="cfg-ttl-label">
                Срок жизни
              </span>
              <div class="ttl-row" role="group" aria-labelledby="cfg-ttl-label">
                <For each={TTL_OPTIONS}>
                  {(seconds) => (
                    <button
                      type="button"
                      aria-pressed={ttlSec() === seconds ? 'true' : 'false'}
                      class="ttl-btn"
                      classList={{ 'is-active': ttlSec() === seconds }}
                      onClick={() => setTtlSec(seconds)}
                    >
                      {ttlLabel(seconds)}
                    </button>
                  )}
                </For>
              </div>
              <p class="field-hint">
                Машина остановится сама в конце срока, плата рассчитается по факту. Гостю доступно до
                24 часов.
              </p>
            </div>

            <Field
              label="Площадка"
              for="cfg-region"
              hint="Рабочие образы Rox лежат в США — она выбрана по умолчанию."
            >
              <Select
                id="cfg-region"
                options={regionOptions()}
                value={region()}
                onChange={(event) => {
                  setRegionTouched(true)
                  setRegion(event.currentTarget.value)
                }}
              />
            </Field>
            <Show when={region().length > 0 && region() !== 'us'}>
              <p class="field-hint">
                Сейчас рабочие образы Rox лежат в США: на другой площадке образа может не найтись, и
                запуск остановится до резерва.
              </p>
            </Show>
            <Show when={regionNote()}>
              {(note) => <p class="field-hint">{note()}</p>}
            </Show>

            <dl class="summary-rows">
              <Show when={ownKey()}>
                <div>
                  <dt>Полная цена железа</dt>
                  <dd class="muted">{formatMoney(retail(), { perHour: true })}</dd>
                </div>
              </Show>
              <div>
                <dt>Резерв за {ttlLabel(ttlSec())}</dt>
                <dd>{formatCents(hold())}</dd>
              </div>
              <div>
                <dt>Баланс сейчас</dt>
                <dd>{formatCents(balance())}</dd>
              </div>
              <div class="summary-total">
                <dt>Остаток после запуска</dt>
                <dd>{formatCents(after())}</dd>
              </div>
            </dl>

            <Show when={catalogFailure()}>
              {(failure) => (
                <p class="field-hint">
                  Каталог не загрузился ({failure()}), поэтому площадки проверены не полностью:
                  окончательный ответ даст сервер при запуске.
                </p>
              )}
            </Show>

            <Show when={launchError()}>
              {(failure) => (
                <div class="console-alert" role="alert">
                  <span>{failure().message}</span>
                  <Show when={failure().code !== null || failure().requestId !== null}>
                    <span class="console-alert-meta">
                      {[failure().code, failure().requestId === null ? null : `запрос ${failure().requestId}`]
                        .filter((part) => part !== null && part.length > 0)
                        .join(' · ')}
                    </span>
                  </Show>
                </div>
              )}
            </Show>

            <Show when={blocked()}>
              {(reason) => (
                <div class="console-block" role="status">
                  <span>{reason().text}</span>
                  <Show when={reason().kind === 'topup'}>
                    <Button size="sm" variant="secondary" onClick={() => session.openTopUp()}>
                      Пополнить
                    </Button>
                  </Show>
                  <Show when={reason().kind === 'account'}>
                    <Button size="sm" variant="secondary" onClick={() => void session.refreshAccount()}>
                      Обновить счёт
                    </Button>
                  </Show>
                </div>
              )}
            </Show>

            <Button
              variant="primary"
              size="lg"
              block
              loading={launching()}
              disabled={blocked() !== null}
              icon={<Icon name="play" size={15} />}
              onClick={() => void launch()}
            >
              <RollingText text="Запустить" />
            </Button>
            <p class="summary-foot">
              Остановка считает плату по фактическому времени, остаток резерва возвращается на счёт.
            </p>
          </Card>
        </aside>
      </div>
    </section>
  )
}
