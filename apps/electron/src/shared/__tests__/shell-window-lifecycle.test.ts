import { describe, expect, it } from 'bun:test'
import { initialZenWindowState, reduceZenWindow } from '../shell-window-lifecycle'

describe('reduceZenWindow', () => {
  it('did-finish-load and timeout show once without applying glass', () => {
    const afterLoad = reduceZenWindow(initialZenWindowState(), { type: 'did-finish-load' })
    expect(afterLoad.shown).toBe(true)
    expect(afterLoad.applyMaterial).toBe(false)
    expect(afterLoad.paintGeneration).toBeNull()

    const afterTimeout = reduceZenWindow(initialZenWindowState(), { type: 'timeout' })
    expect(afterTimeout.shown).toBe(true)
    expect(afterTimeout.applyMaterial).toBe(false)
  })

  it('ready-to-show shows once and applies material', () => {
    const painted = reduceZenWindow(initialZenWindowState(), { type: 'ready-to-show' })
    expect(painted.shown).toBe(true)
    expect(painted.applyMaterial).toBe(true)
    expect(painted.paintGeneration).toBe(0)
    expect(painted.generation).toBe(0)
  })

  it('late ready-to-show still applies material after an opaque first show', () => {
    let state = reduceZenWindow(initialZenWindowState(), { type: 'did-finish-load' })
    expect(state.shown).toBe(true)
    expect(state.applyMaterial).toBe(false)
    state = reduceZenWindow(state, { type: 'ready-to-show' })
    expect(state.shown).toBe(true)
    expect(state.applyMaterial).toBe(true)
    expect(state.paintGeneration).toBe(0)
  })

  it('gpu-crash increments generation and clears material', () => {
    let state = reduceZenWindow(initialZenWindowState(), { type: 'ready-to-show' })
    state = reduceZenWindow(state, { type: 'gpu-crash' })
    expect(state.generation).toBe(1)
    expect(state.paintGeneration).toBeNull()
    expect(state.clearMaterial).toBe(true)
    expect(state.applyMaterial).toBe(false)
  })

  it('policy-change applies only when paintGeneration matches generation', () => {
    const unpainted = reduceZenWindow(initialZenWindowState(), { type: 'policy-change' })
    expect(unpainted.applyMaterial).toBe(false)

    let painted = reduceZenWindow(initialZenWindowState(), { type: 'ready-to-show' })
    painted = reduceZenWindow(painted, { type: 'policy-change' })
    expect(painted.applyMaterial).toBe(true)

    let crashed = reduceZenWindow(painted, { type: 'gpu-crash' })
    crashed = reduceZenWindow(crashed, { type: 'policy-change' })
    expect(crashed.applyMaterial).toBe(false)
    expect(crashed.generation).not.toBe(crashed.paintGeneration)
  })
})
