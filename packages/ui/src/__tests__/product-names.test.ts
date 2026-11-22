import { describe, expect, test } from 'bun:test'
import { CLOUD_PRODUCTS, CLOUD_UNITS, productLabel, unitLabel } from '../lib/product-names.ts'

describe('cloud product vocabulary', () => {
  test('has exactly seven products with unique ids and names', () => {
    expect(CLOUD_PRODUCTS).toHaveLength(7)
    expect(new Set(CLOUD_PRODUCTS.map((p) => p.id)).size).toBe(7)
    expect(new Set(CLOUD_PRODUCTS.map((p) => p.name)).size).toBe(7)
  })

  test('every product has a short Russian definition', () => {
    for (const product of CLOUD_PRODUCTS) {
      expect(product.name.length).toBeGreaterThan(2)
      expect(product.nameEn.length).toBeGreaterThan(2)
      expect(product.definition.length).toBeGreaterThan(20)
      expect(product.definition.length).toBeLessThanOrEqual(120)
      expect(product.definition.endsWith('.')).toBe(true)
    }
  })

  test('has five units and resolves their labels', () => {
    expect(CLOUD_UNITS).toHaveLength(5)
    expect(unitLabel('vcpu_hour')).toBe('час ядра')
    expect(unitLabel('gpu_hour')).toBe('час видеокарты')
  })

  test('resolves known products and passes unknown ids through', () => {
    expect(productLabel('sandbox')).toBe('Песочницы')
    expect(productLabel('volume')).toBe('Диски')
    expect(productLabel('something_else')).toBe('something_else')
  })
})
