/**
 * Canonical Rox Cloud product names, units and one-line definitions.
 *
 * One vocabulary for the console, the public documentation and the invoice:
 * the customer must see the same seven words everywhere. Internal identifiers
 * never change; only the words shown to a person come from here.
 */

export interface CloudProduct {
  /** Stable id used in the API and the price list. */
  readonly id: 'sandbox' | 'desktop' | 'gpu' | 'job' | 'deployment' | 'volume' | 'template'
  /** The word a customer sees, Russian by default. */
  readonly name: string
  /** English name for code, logs and the API reference. */
  readonly nameEn: string
  /** One line a high-school student understands. */
  readonly definition: string
}

export interface CloudUnit {
  readonly id: 'vcpu_hour' | 'gib_hour' | 'gib_month' | 'gpu_hour' | 'build_minute'
  readonly name: string
  readonly nameEn: string
}

export const CLOUD_PRODUCTS: readonly CloudProduct[] = [
  {
    id: 'sandbox',
    name: 'Песочницы',
    nameEn: 'Sandboxes',
    definition: 'Изолированная машина на минуты или часы: выполнить код, запустить агента, собрать проект.',
  },
  {
    id: 'desktop',
    name: 'Рабочие столы',
    nameEn: 'Desktops',
    definition: 'Машина с экраном, мышью и клавиатурой для Linux, Windows или macOS.',
  },
  {
    id: 'gpu',
    name: 'Видеокарты',
    nameEn: 'GPUs',
    definition: 'Почасовая аренда видеокарты для обучения, вывода моделей и агентов.',
  },
  {
    id: 'job',
    name: 'Задания',
    nameEn: 'Jobs',
    definition: 'Пакетная работа: прогнать много задач параллельно и забрать результат.',
  },
  {
    id: 'deployment',
    name: 'Службы',
    nameEn: 'Deployments',
    definition: 'Постоянный адрес, который отвечает по сети и сам масштабируется.',
  },
  {
    id: 'volume',
    name: 'Диски',
    nameEn: 'Volumes',
    definition: 'Постоянное хранилище, общее для нескольких машин.',
  },
  {
    id: 'template',
    name: 'Шаблоны',
    nameEn: 'Templates',
    definition: 'Образ машины из файла сборки: собрали один раз, запускаете тысячи.',
  },
] as const

export const CLOUD_UNITS: readonly CloudUnit[] = [
  { id: 'vcpu_hour', name: 'час ядра', nameEn: 'vCPU-hour' },
  { id: 'gib_hour', name: 'час гигабайта памяти', nameEn: 'GiB-hour' },
  { id: 'gib_month', name: 'гигабайт в месяц', nameEn: 'GiB-month' },
  { id: 'gpu_hour', name: 'час видеокарты', nameEn: 'GPU-hour' },
  { id: 'build_minute', name: 'минута сборки', nameEn: 'build-minute' },
] as const

const PRODUCT_BY_ID = new Map<string, CloudProduct>(CLOUD_PRODUCTS.map((p) => [p.id, p]))
const UNIT_BY_ID = new Map<string, CloudUnit>(CLOUD_UNITS.map((u) => [u.id, u]))

/** The word a customer sees, or the raw id when it is not a known product. */
export function productLabel(id: string): string {
  return PRODUCT_BY_ID.get(id)?.name ?? id
}

/** The unit a customer sees, or the raw id when it is not a known unit. */
export function unitLabel(id: string): string {
  return UNIT_BY_ID.get(id)?.name ?? id
}
