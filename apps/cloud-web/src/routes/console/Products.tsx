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
  Skeleton,
  Switch,
  useToast,
} from '@/components'
import type { BadgeTone } from '@/components'
import { ApiError, api } from '@/lib/api'
import type { Catalog, GpuSpec, ProviderImage } from '@/lib/api'
import { formatCents, formatMoney, shortId } from '@/lib/format'

import { Stepper } from './components/Stepper'
import { useConsoleSession } from './components/console-session'
import { coresLabel, errorText, gpuName, sizeLine, ttlLabel } from './components/console-ui'

import './products.css'

type GroupId = 'linux' | 'windows' | 'gpu'

const GROUPS: readonly { id: GroupId; label: string; hint: string }[] = [
  { id: 'linux', label: 'Linux', hint: 'Сервер и разработка' },
  { id: 'windows', label: 'Windows', hint: 'Рабочий стол' },
  { id: 'gpu', label: 'GPU', hint: 'Видеокарта в комплекте' },
]

const KNOWN_REGIONS: Record<string, string> = {
  us: 'Общая (us)',
  'us-west-4': 'Выделенная (us-west-4)',
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
  /** The price list's own words for why a product is unavailable. */
  note?: string
}

/** The price list plus the flags it now carries for unavailable snapshots. */
type SellableProduct = CloudMachineProduct & {
  readonly available?: boolean
  readonly note?: string
}

const PRODUCTS: readonly SellableProduct[] = DEFAULT_PRODUCTS

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
  return {
    id: image.id,
    name,
    label: image.label ?? name,
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
  'daytona-small':
    'Старый снимок Daytona: команды в нём падают с «permission denied». Выберите образ из пресетов.',
  'daytona-medium':
    'Старый снимок Daytona: команды в нём падают с «permission denied». Выберите образ из пресетов.',
  'daytona-large':
    'Старый снимок Daytona: команды в нём падают с «permission denied». Выберите образ из пресетов.',
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

interface LaunchBlock {
  text: string
  kind: 'providers' | 'topup' | 'account' | 'images' | 'wait' | 'unavailable'
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

  const [group, setGroup] = createSignal<GroupId>('linux')
  const [plainGroup, setPlainGroup] = createSignal<GroupId>('linux')
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

  const pool = createMemo<MachineImage[]>(() => {
    const cpuLimit = session.guest() ? 16 : 32
    const current = group()
    return allImages().filter((image) => {
      if (image.available === false) return false
      if (image.cpu > cpuLimit) return false
      if (current === 'gpu') return image.gpu !== null
      if (current === 'windows') return image.os === 'windows' && image.gpu === null
      return image.os === 'linux' && image.gpu === null
    })
  })

  const nearest = createMemo<MachineImage | undefined>(() =>
    nearestImage(pool(), targetCpu(), targetMemory(), targetDisk()),
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

  const activePreset = (product: CloudMachineProduct): boolean => {
    const image = selected()
    return (
      image !== undefined &&
      image.name === product.snapshot &&
      image.cpu === product.cpu &&
      image.memoryGb === product.memoryGb
    )
  }

  const selectPreset = (product: SellableProduct): void => {
    if (product.available === false) {
      setPlanNote(product.note ?? `«${product.name}» сейчас недоступен: выберите другой продукт.`)
      return
    }
    const fallback = presetImage(product)
    const live = allImages().find(
      (image) =>
        image.name === product.snapshot &&
        image.cpu === product.cpu &&
        image.memoryGb === product.memoryGb &&
        image.diskGb === product.diskGb,
    )
    const image = live ?? fallback
    const nextGroup = groupOf(product)
    setGroup(nextGroup)
    if (nextGroup !== 'gpu') setPlainGroup(nextGroup)
    setTargetCpu(image.cpu)
    setTargetMemory(image.memoryGb)
    setTargetDisk(image.diskGb ?? product.diskGb)
    setPicked(image)
    setLaunchError(null)
    setPlanNote(null)
  }

  const chooseGroup = (next: GroupId): void => {
    if (next === group()) return
    if (next !== 'gpu') setPlainGroup(next)
    const inGroup = PRODUCTS.filter((product) => groupOf(product) === next)
    const available = inGroup.find((product) => product.available !== false)
    if (available !== undefined) {
      selectPreset(available)
      return
    }
    setGroup(next)
    setPicked(undefined)
    setLaunchError(null)
    const note = inGroup.find((product) => product.note !== undefined)?.note
    const label = GROUPS.find((entry) => entry.id === next)?.label ?? next
    setPlanNote(
      note ?? (inGroup.length === 0 ? null : `В группе «${label}» сейчас нет доступных продуктов.`),
    )
  }

  const selectImage = (image: MachineImage): void => {
    setGroup(groupOf(image))
    setTargetCpu(image.cpu)
    setTargetMemory(image.memoryGb)
    setTargetDisk(image.diskGb ?? targetDisk())
    setPicked(image)
    setLaunchError(null)
  }

  const applyCustom = (): void => {
    const name = customName().trim()
    if (name.length === 0 || group() === 'gpu') return
    setPicked({
      id: name,
      name,
      label: `Свой снимок ${name}`,
      os: group() === 'windows' ? 'windows' : 'linux',
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
      setImagesFailure(errorText(err))
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
      setCatalogFailure(errorText(err))
      // Even without the catalog the known working region is `us`: leaving the
      // field empty would let the provider choose a region with no snapshot.
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
      // A guest key cannot read provider keys; a guest has none by definition.
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
      setPlanNote(`Продукта «${code}» в каталоге нет: выберите состав ниже.`)
      return
    }
    setPlanNote(null)
    selectPreset(product)
  })

  const daytonaListed = createMemo<boolean>(() => {
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
      { value: '', label: 'Поставщик выбирает сам' },
      ...list.map((id) => ({ value: id, label: KNOWN_REGIONS[id] ?? `${id} — площадка поставщика` })),
    ]
  })

  const regionNote = createMemo<string | null>(() => {
    if (catalog() === undefined) return null
    const provider = catalog()?.providers?.find((entry) => entry.id === 'daytona')
    if (provider !== undefined && (provider.regions?.length ?? 0) > 0) return null
    return 'Каталог не прислал список площадок: показаны известные — us (общая) и us-west-4 (выделенная). Рабочие снимки Rox сейчас лежат в us.'
  })

  const retail = createMemo<number>(() => {
    const image = selected()
    if (image === undefined) return 0
    return retailCentsPerHour({
      cpu: image.cpu,
      memoryGb: image.memoryGb,
      diskGb: image.diskGb ?? 0,
      gpu: gpuCents(image.gpu),
    })
  })

  const byok = createMemo<boolean>(() => ownKey())
  const rate = createMemo<number>(() =>
    byok() ? serviceFeeCentsPerHour(retail()) : retail(),
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
      return { kind: 'images', text: 'Нет подходящего образа: смените группу или обновите список.' }
    }
    if (image.available === false) {
      return {
        kind: 'unavailable',
        text: image.note ?? 'Этот снимок сейчас недоступен: выберите другой продукт.',
      }
    }
    if (!credentialsChecked()) {
      return { kind: 'wait', text: 'Проверяем, есть ли у вас свой ключ Daytona: от этого зависит цена.' }
    }
    if (catalog() === undefined && catalogFailure() === null) {
      return { kind: 'wait', text: 'Проверяем площадки и платформенный ключ Rox…' }
    }
    if (!daytonaListed()) {
      return { kind: 'providers', text: 'Поставщик Daytona не подключён в этой сборке — запускать не на чем.' }
    }
    if (!byok() && catalog() !== undefined && !managedAvailable()) {
      return {
        kind: 'providers',
        text: 'Нет ни своего ключа Daytona, ни платформенного ключа Rox. Добавьте свой ключ в разделе «Поставщики».',
      }
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
      return {
        label: 'Режим…',
        tone: 'neutral',
        hint: 'Проверяем, есть ли у вас свой ключ Daytona: от этого зависит цена часа.',
      }
    }
    if (byok()) {
      return {
        label: 'Свой ключ',
        tone: 'success',
        hint: 'Железо вы платите Daytona напрямую, Rox берёт только сервисный сбор за управление.',
      }
    }
    if (catalog() !== undefined && !managedAvailable()) {
      return {
        label: 'Нет ключа',
        tone: 'danger',
        hint: 'Ни своего ключа Daytona, ни платформенного ключа Rox в этой сборке нет.',
      }
    }
    if (credentialsFailure() !== null && !session.guest()) {
      return {
        label: 'Режим?',
        tone: 'neutral',
        hint: 'Список своих ключей не получен: окончательный режим и цену назовёт сервер при запуске.',
      }
    }
    return {
      label: 'Ключ Rox',
      tone: 'accent',
      hint: session.guest()
        ? 'Пробный доступ: машина на ключе Rox, платите полную цену с пробного баланса.'
        : 'Машина идёт на ключе Rox: платите полную цену с баланса, без своего аккаунта у Daytona.',
    }
  })

  const imagesSubtitle = (): string => {
    const state = imagesState()
    if (state === 'loading') return 'Запрашиваем живой список у Daytona'
    if (state === 'live') return 'Живой список Daytona: только активные снимки'
    if (state === 'empty') return 'Снимки из каталога: Daytona не вернул активных'
    return 'Снимки из каталога: живой список недоступен'
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
    return `У Daytona снимок ${image.name} сейчас другого состава: ${sizeLine(live)}. Показан состав каталога, по которому считается цена; сверить фактический состав можно в терминале после запуска.`
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
        message: errorText(err),
        code: failure === null ? null : failure.code,
        requestId: failure === null ? null : failure.requestId,
      })
    } finally {
      setLaunching(false)
    }
  }

  return (
    <section class="page products-page">
      <PageHeader
        eyebrow="Кабинет"
        title="Соберите машину"
        description="Пресет, образ, ресурсы, площадка и срок жизни на одном экране. Цена часа и резерв пересчитываются сразу."
        actions={
          <A href="/console/machines" class="btn btn-secondary btn-sm">
            Мои машины
          </A>
        }
      />

      <Show when={planNote()}>
        {(note) => <div class="console-note">{note()}</div>}
      </Show>

      <div class="console-grid">
        <div class="console-col stack-lg">
          <Card title="Пресеты" subtitle="Готовые составы из каталога Rox">
            <div class="preset-groups">
              <For each={GROUPS}>
                {(entry) => (
                  <div class="preset-group">
                    <div class="preset-group-head">
                      <span class="preset-group-label">{entry.label}</span>
                      <span class="preset-group-hint">{entry.hint}</span>
                    </div>
                    <div class="preset-list">
                      <For each={PRODUCTS.filter((product) => groupOf(product) === entry.id)}>
                        {(product) => {
                          const unavailable = product.available === false
                          return (
                            <button
                              type="button"
                              class="preset"
                              classList={{
                                'is-active': activePreset(product),
                                'is-unavailable': unavailable,
                              }}
                              aria-pressed={activePreset(product)}
                              disabled={unavailable}
                              title={product.note ?? undefined}
                              onClick={() => selectPreset(product)}
                            >
                              <span class="preset-name">{product.name}</span>
                              <span class="preset-size">
                                {sizeLine({
                                  cpu: product.cpu,
                                  memoryGb: product.memoryGb,
                                  diskGb: product.diskGb,
                                  gpu: product.gpu ?? null,
                                })}
                              </span>
                              <span class="preset-price">
                                {unavailable
                                  ? 'Недоступно'
                                  : formatMoney(product.centsPerHour, { perHour: true })}
                              </span>
                              <Show when={unavailable && product.note !== undefined}>
                                <span class="preset-note">{product.note}</span>
                              </Show>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Card>

          <Card
            title="Образы"
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
            <Show
              when={imagesState() !== 'loading'}
              fallback={
                <div class="stack">
                  <Skeleton lines={5} />
                  <p class="console-muted small">
                    Пока идёт запрос, пресеты слева уже можно выбирать: их состав берётся из каталога.
                  </p>
                </div>
              }
            >
              <Show
                when={pool().length > 0}
                fallback={
                  <EmptyState
                    icon="box"
                    title="В этой группе нет образов"
                    description={
                      group() === 'gpu'
                        ? 'У доступных снимков нет видеокарты. Выключите «С видеокартой» или обновите список.'
                        : 'Смените группу, обновите список или выберите пресет слева.'
                    }
                  />
                }
              >
                <div class="image-list" role="group" aria-label="Образы Daytona">
                  <For each={pool()}>
                    {(image) => (
                      <button
                        type="button"
                        aria-pressed={
                          selected()?.name === image.name && selected()?.cpu === image.cpu ? 'true' : 'false'
                        }
                        class="image-item"
                        classList={{
                          'is-active': selected()?.name === image.name && selected()?.cpu === image.cpu,
                        }}
                        onClick={() => selectImage(image)}
                      >
                        <span class="image-main">
                          <span class="image-name">{image.label}</span>
                          <span class="image-size">{sizeLine(image)}</span>
                        </span>
                        <span class="image-tags">
                          <Show when={image.gpu !== null}>
                            <Badge tone="accent">{gpuName(image.gpu)}</Badge>
                          </Show>
                          <Show when={image.custom === true}>
                            <Badge tone="warning">Свой снимок</Badge>
                          </Show>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={imagesState() === 'fallback'}>
                <div class="console-note" role="status">
                  Живой список образов недоступен: {imagesFailure()}. Показаны снимки из каталога — состав
                  и цена точные, доступность проверит сервер при запуске.
                </div>
              </Show>
              <Show when={imagesState() === 'empty'}>
                <div class="console-note" role="status">
                  Daytona не вернул ни одного активного снимка. Показаны снимки из каталога: сервер
                  откажет, если такого снимка у поставщика нет.
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
                  hint={
                    group() === 'gpu'
                      ? 'Для машины с видеокартой выберите образ из списка: цену карты сервер берёт из снимка.'
                      : 'Имя снимка Daytona. Ресурсы сервер проверит по снимку; при расхождении запуск остановится до резерва. Цена часа посчитана без видеокарты.'
                  }
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
                      disabled={group() === 'gpu'}
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
                      disabled={group() === 'gpu' || customName().trim().length === 0}
                      onClick={applyCustom}
                    >
                      Выбрать
                    </Button>
                  </div>
                </Field>
              </div>
            </Show>
          </Card>
        </div>

        <div class="console-col stack-lg">
          <Card title="Ресурсы" subtitle="Ползунки выбирают ближайший живой образ, а не выдумывают состав">
            <div class="stepper-grid">
              <Stepper
                id="cfg-cpu"
                label="Процессор"
                value={targetCpu()}
                unit="ядра"
                min={1}
                max={session.guest() ? 16 : 32}
                hint={session.guest() ? 'Гостю до 16 ядер' : undefined}
                onChange={(value) => {
                  setTargetCpu(value)
                  setPicked(undefined)
                }}
              />
              <Stepper
                id="cfg-memory"
                label="Память"
                value={targetMemory()}
                unit="ГБ"
                min={1}
                max={128}
                onChange={(value) => {
                  setTargetMemory(value)
                  setPicked(undefined)
                }}
              />
              <Stepper
                id="cfg-disk"
                label="Диск"
                value={targetDisk()}
                unit="ГБ"
                min={1}
                max={500}
                step={5}
                onChange={(value) => {
                  setTargetDisk(value)
                  setPicked(undefined)
                }}
              />
            </div>

            <Switch
              checked={group() === 'gpu'}
              onChange={(checked) => chooseGroup(checked ? 'gpu' : plainGroup())}
              label="С видеокартой"
              hint="Показывать только образы с GPU: H100, L4, A10, T4"
            />

            <Show
              when={selected()}
              fallback={
                <div class="console-note" role="status">
                  Образ не выбран: в этой группе нет доступных снимков.
                </div>
              }
            >
              {(image) => (
                <div class="chosen">
                  <div class="chosen-head">
                    <span class="chosen-label">
                      {exact() ? 'Точный образ' : 'Точного образа нет, ближайший'}
                    </span>
                    <Badge tone={exact() ? 'success' : 'warning'}>{image().label}</Badge>
                  </div>
                  <dl class="chosen-grid">
                    <div>
                      <dt>Процессор</dt>
                      <dd>{coresLabel(image().cpu)}</dd>
                    </div>
                    <div>
                      <dt>Память</dt>
                      <dd>{image().memoryGb} ГБ</dd>
                    </div>
                    <div>
                      <dt>Диск</dt>
                      <dd>{image().diskGb === undefined ? 'по снимку' : `${image().diskGb} ГБ`}</dd>
                    </div>
                    <Show when={image().gpu !== null}>
                      <div>
                        <dt>Видеокарта</dt>
                        <dd>{gpuName(image().gpu)}</dd>
                      </div>
                    </Show>
                  </dl>
                  <Show when={!exact()}>
                    <p class="field-hint">
                      Вы просили {coresLabel(targetCpu())}, {targetMemory()} ГБ памяти и {targetDisk()} ГБ
                      диска. Машина получит точный состав ближайшего образа: {sizeLine(image())}.
                    </p>
                  </Show>
                </div>
              )}
            </Show>
          </Card>

          <Card title="Площадка и срок" subtitle="Где запустится машина и сколько она проживёт">
            <Field
              label="Площадка"
              for="cfg-region"
              hint="Рабочие снимки Rox сейчас лежат в us — она выбрана по умолчанию. Пусто — поставщик выберет сам."
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
                Сейчас рабочие снимки Rox лежат в us: на другой площадке снимок может не найтись, и запуск
                остановится до резерва.
              </p>
            </Show>
            <Show when={regionNote()}>
              {(note) => <p class="field-hint">{note()}</p>}
            </Show>

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
                Машина остановится сама в конце срока, плата рассчитается по факту. Гостю доступно до 24
                часов.
              </p>
            </div>

            <Show when={catalogFailure()}>
              {(failure) => (
                <p class="field-hint">
                  Каталог не загрузился ({failure()}), поэтому площадки и платформенный ключ проверены не
                  полностью: окончательный ответ даст сервер при запуске.
                </p>
              )}
            </Show>
          </Card>
        </div>

        <aside class="console-col console-summary">
          <Card title="Итог" subtitle="Цена и резерв до запуска">
            <div class="summary-mode">
              <Badge tone={mode().tone}>{mode().label}</Badge>
              <span class="summary-mode-text">{mode().hint}</span>
            </div>

            <div class="summary-image">
              <Show
                when={selected()}
                fallback={<div class="summary-image-name">Образ не выбран</div>}
              >
                {(image) => (
                  <>
                    <div class="summary-image-name">{image().label}</div>
                    <div class="summary-image-size">{sizeLine(image())}</div>
                  </>
                )}
              </Show>
            </div>

            <dl class="summary-rows">
              <div>
                <dt>Цена часа</dt>
                <dd>{formatMoney(rate(), { perHour: true })}</dd>
              </div>
              <Show when={byok()}>
                <div>
                  <dt>Полная цена у поставщика</dt>
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
                  <Show when={reason().kind === 'providers'}>
                    <A href="/console/providers" class="btn btn-secondary btn-sm">
                      Поставщики
                    </A>
                  </Show>
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
              Запустить
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
