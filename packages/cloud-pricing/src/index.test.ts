/**
 * Price-list tests: the table, the formula and the fee.
 *
 * The table in the spec is the source of truth; every row is recomputed here
 * from its own resources, so a typo in either place fails the suite.
 */

import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_PRODUCTS,
  MIN_SERVICE_FEE_CENTS_PER_HOUR,
  findProduct,
  formatCents,
  gpuCentsPerHour,
  retailCentsPerHour,
  serviceFeeCentsPerHour,
} from '../src/index.ts'

describe('DEFAULT_PRODUCTS', () => {
  test('holds the eight products of the spec in order', () => {
    expect(DEFAULT_PRODUCTS.map((product) => product.id)).toEqual([
      'linux-start',
      'linux-pro',
      'linux-large',
      'windows-start',
      'windows-pro',
      'windows-large',
      'windows-xl',
      'gpu-h100',
    ])
  })

  test('carries the exact snapshot, resources and price of every row', () => {
    const expected = [
      ['linux-start', 'daytonaio/sandbox:0.11.0', 'linux', 1, 1, 3, undefined, 20],
      ['linux-pro', 'rox-cloud-medium-2x4', 'linux', 2, 4, 8, undefined, 36],
      ['linux-large', 'rox-cloud-large-4x8', 'linux', 4, 8, 10, undefined, 60],
      ['windows-start', 'windows-small', 'windows', 1, 4, 30, undefined, 34],
      ['windows-pro', 'windows-medium', 'windows', 2, 8, 50, undefined, 56],
      ['windows-large', 'windows-large', 'windows', 4, 16, 50, undefined, 92],
      ['windows-xl', 'windows-xlarge', 'windows', 8, 32, 100, undefined, 174],
      ['gpu-h100', 'daytona-gpu', 'linux', 16, 100, 400, { type: 'h100', count: 1 }, 786],
    ] as const

    expect(DEFAULT_PRODUCTS).toHaveLength(expected.length)
    for (const [id, snapshot, os, cpu, memoryGb, diskGb, gpu, cents] of expected) {
      const product = findProduct(id)
      expect(product).toMatchObject({
        id,
        snapshot,
        os,
        cpu,
        memoryGb,
        diskGb,
        centsPerHour: cents,
      })
      expect(product?.gpu).toEqual(gpu as { type: string; count: number } | undefined)
    }
  })

  test('every price equals the formula applied to its own resources', () => {
    for (const product of DEFAULT_PRODUCTS) {
      const gpu =
        product.gpu === undefined ? undefined : gpuCentsPerHour(product.gpu.type, product.gpu.count)
      const computed = retailCentsPerHour({
        cpu: product.cpu,
        memoryGb: product.memoryGb,
        diskGb: product.diskGb,
        ...(gpu === undefined ? {} : { gpu }),
      })
      expect({ id: product.id, cents: computed }).toEqual({
        id: product.id,
        cents: product.centsPerHour,
      })
    }
  })

  test('the Linux products are sellable here and the blocked classes say why', () => {
    for (const id of ['linux-start', 'linux-pro', 'linux-large']) {
      expect(findProduct(id)?.available).toBe(true)
      expect(findProduct(id)?.note).toBeUndefined()
    }
    for (const id of ['windows-start', 'windows-pro', 'windows-large', 'windows-xl']) {
      expect(findProduct(id)?.available).toBe(false)
      expect(findProduct(id)?.note).toBe('Класс Windows недоступен в этом аккаунте Daytona')
    }
    expect(findProduct('gpu-h100')?.available).toBe(false)
    expect(findProduct('gpu-h100')?.note).toBe('Нужны GPU-кредиты Daytona')
  })

  test('no product points at the custom snapshots that fail exec', () => {
    const broken = new Set(['daytona-small', 'daytona-medium', 'daytona-large'])
    for (const product of DEFAULT_PRODUCTS) {
      expect(broken.has(product.snapshot)).toBe(false)
    }
  })

  test('an unknown product id is not silently invented', () => {
    expect(findProduct('windows-max')).toBeUndefined()
  })
})

describe('retailCentsPerHour', () => {
  test('matches the published price of a small Linux machine', () => {
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1, diskGb: 3 })).toBe(20)
  })

  test('rounds 50 GiB of disk up correctly instead of by a float error', () => {
    // 10 + 12 + 24 + 10 = 56 exactly; 0.2 × 50 in floats would give 57.
    expect(retailCentsPerHour({ cpu: 2, memoryGb: 8, diskGb: 50 })).toBe(56)
  })

  test('rounds a fractional term up to a whole cent', () => {
    // 10 + 6 + 3 + 0.2 = 19.2 → 20
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1, diskGb: 1 })).toBe(20)
    // 10 + 6 + 3 + 1 = 20 exactly
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1, diskGb: 5 })).toBe(20)
  })

  test('treats a missing or zero disk as no disk term', () => {
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1 })).toBe(19)
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1, diskGb: 0 })).toBe(19)
  })

  test('adds the GPU total it is given', () => {
    expect(retailCentsPerHour({ cpu: 16, memoryGb: 100, diskGb: 400, gpu: 300 })).toBe(786)
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 1, gpu: 90 })).toBe(109)
  })

  test('grows by exactly six cents per CPU and three per GiB', () => {
    const base = retailCentsPerHour({ cpu: 1, memoryGb: 1 })
    expect(retailCentsPerHour({ cpu: 2, memoryGb: 1 }) - base).toBe(6)
    expect(retailCentsPerHour({ cpu: 1, memoryGb: 2 }) - base).toBe(3)
  })
})

describe('gpuCentsPerHour', () => {
  test('prices every known card from the spec', () => {
    expect(gpuCentsPerHour('h100')).toBe(300)
    expect(gpuCentsPerHour('l4')).toBe(90)
    expect(gpuCentsPerHour('a10')).toBe(120)
    expect(gpuCentsPerHour('t4')).toBe(60)
  })

  test('prices an unknown model like an A10 instead of free', () => {
    expect(gpuCentsPerHour('b200')).toBe(120)
    expect(gpuCentsPerHour('')).toBe(120)
    expect(gpuCentsPerHour('T4 ')).toBe(60)
    expect(gpuCentsPerHour('H100')).toBe(300)
  })

  test('multiplies by the card count, defaulting to one', () => {
    expect(gpuCentsPerHour('h100', 2)).toBe(600)
    expect(gpuCentsPerHour('a10', 4)).toBe(480)
    expect(gpuCentsPerHour('a10', 0)).toBe(120)
    expect(gpuCentsPerHour('a10', Number.NaN)).toBe(120)
  })
})

describe('serviceFeeCentsPerHour', () => {
  test('is 15 % of retail, rounded to a whole cent', () => {
    expect(serviceFeeCentsPerHour(36)).toBe(5)
    expect(serviceFeeCentsPerHour(60)).toBe(9)
    expect(serviceFeeCentsPerHour(174)).toBe(26)
    expect(serviceFeeCentsPerHour(786)).toBe(118)
    expect(serviceFeeCentsPerHour(1000)).toBe(150)
  })

  test('never falls below five cents an hour', () => {
    expect(serviceFeeCentsPerHour(20)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
    expect(serviceFeeCentsPerHour(5)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
    expect(serviceFeeCentsPerHour(1)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
  })

  test('refuses a nonsense retail price without asking for money back', () => {
    expect(serviceFeeCentsPerHour(0)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
    expect(serviceFeeCentsPerHour(-10)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
    expect(serviceFeeCentsPerHour(Number.NaN)).toBe(MIN_SERVICE_FEE_CENTS_PER_HOUR)
  })
})

describe('formatCents', () => {
  test('prints whole dollars, cents and a comma separator', () => {
    expect(formatCents(2000)).toBe('20,00 $')
    expect(formatCents(786)).toBe('7,86 $')
    expect(formatCents(5)).toBe('0,05 $')
    expect(formatCents(0)).toBe('0,00 $')
  })

  test('keeps a minus sign in front of a refund', () => {
    expect(formatCents(-150)).toBe('−1,50 $')
  })
})
