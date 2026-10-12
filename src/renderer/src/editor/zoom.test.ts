import { describe, expect, it } from 'vitest'
import { zoomByWheel, zoomStep } from './zoom'

describe('zoomStep', () => {
  it('moves between round zoom levels', () => {
    expect(zoomStep(1, 1)).toBe(1.1)
    expect(zoomStep(1, -1)).toBe(0.9)
    expect(zoomStep(1.1, 1)).toBe(1.25)
    expect(zoomStep(1.1, -1)).toBe(1)
  })

  it('stops at the smallest and largest level', () => {
    expect(zoomStep(2.5, 1)).toBe(2.5)
    expect(zoomStep(0.7, -1)).toBe(0.7)
  })
})

describe('zoomByWheel', () => {
  it('zooms a little per pinch event and stays in range', () => {
    const z = zoomByWheel(1, -10)
    expect(z).toBeGreaterThan(1)
    expect(z).toBeLessThan(1.05)
    expect(zoomByWheel(1, 500)).toBeCloseTo(0.7)
    expect(zoomByWheel(2.4, -5000)).toBe(2.5)
  })
})
