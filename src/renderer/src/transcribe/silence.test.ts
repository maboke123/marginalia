import { describe, expect, it } from 'vitest'
import { SilenceWatch } from './silence'

describe('SilenceWatch', () => {
  it('reports a microphone that gives only zeros for 3 seconds', () => {
    const watch = new SilenceWatch()
    const quarters = Array.from({ length: 12 }, () => watch.push(0, 0.25))
    expect(quarters.slice(0, 11).some(Boolean)).toBe(false)
    expect(quarters[11]).toBe(true)
  })

  it('stops reporting as soon as there is sound, and ignores a quiet room', () => {
    const watch = new SilenceWatch()
    for (let i = 0; i < 12; i++) watch.push(0, 0.25)
    expect(watch.push(0.02, 0.25)).toBe(false)
    for (let i = 0; i < 40; i++) expect(watch.push(0.0004, 0.25)).toBe(false)
  })
})
