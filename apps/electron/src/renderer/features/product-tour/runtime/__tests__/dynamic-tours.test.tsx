import { beforeEach, describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { clearDynamicTours, useDynamicTours } from '../dynamic-tours'
import { registerDynamicTour } from '../../catalogue/dynamic'
import { devSpaceTour } from '../../catalogue/__tests__/fixtures/dynamic-tour'

beforeEach(() => clearDynamicTours())

function Probe() {
  const tours = useDynamicTours()
  return <span data-tours={tours.map(tour => tour.id).join(',')} />
}

describe('TOUR-DYN runtime dynamic-tour API (D9)', () => {
  test('TOUR-DYN-08 useDynamicTours reflects the live generated source', () => {
    expect(renderToStaticMarkup(<Probe />)).toContain('data-tours=""')
    registerDynamicTour(devSpaceTour())
    expect(renderToStaticMarkup(<Probe />)).toContain('data-tours="DS-repo-overview-1"')
    clearDynamicTours()
    expect(renderToStaticMarkup(<Probe />)).toContain('data-tours=""')
  })
})