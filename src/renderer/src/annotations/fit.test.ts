import { describe, expect, it } from 'vitest'
import type { AnnotationPages, TextBox } from '../../../shared/annotations'
import { fitWidth, placeFitted, planFit, type Measure } from './fit'

// 8 points stay free at the page edges.
const page = { width: 625, height: 400, gap: 8 }
// Text of 30 000 square points: twice as wide is half as tall.
const area: Measure = (width) => 30_000 / width

describe('fitWidth', () => {
  it('keeps the width when the text already fits', () => {
    expect(fitWidth({ x: 10, y: 10, width: 200 }, page, area)).toBe(200)
  })

  it('widens just enough to end above the page bottom', () => {
    // At y=300 there are 92 points left: 30 000 / 92 is about 326 wide.
    const width = fitWidth({ x: 10, y: 300, width: 100 }, page, area)!
    expect(width).toBeGreaterThanOrEqual(326)
    expect(width).toBeLessThan(332)
    expect(area(width)).toBeLessThanOrEqual(92)
  })

  it('gives up when even the right edge of the page is too narrow', () => {
    expect(fitWidth({ x: 500, y: 300, width: 100 }, page, area)).toBeNull()
  })
})

describe('planFit', () => {
  it('moves a box up at the full width before it changes page', () => {
    // 117 wide at x=500 is 256.4 tall: it ends 8 above the bottom from y=135.59.
    expect(planFit({ x: 500, y: 300, width: 100 }, page, area)).toEqual({
      kind: 'fits',
      width: 117,
      y: 135.59
    })
  })

  it('does not move up over a box above it, but goes to a blank page at full width', () => {
    const above = { x: 500, y: 10, width: 117, height: 200 }
    expect(planFit({ x: 500, y: 300, width: 100 }, page, area, [above])).toEqual({
      kind: 'blank',
      x: 8,
      y: 8,
      width: 609
    })
    // A box beside it is no obstacle.
    const beside = { x: 10, y: 10, width: 200, height: 380 }
    expect(planFit({ x: 500, y: 300, width: 100 }, page, area, [beside]).kind).toBe('fits')
  })

  it('moves text too long for the whole page to a blank page', () => {
    const long: Measure = (width) => 120_000 / width
    expect(planFit({ x: 500, y: 300, width: 100 }, page, long).kind).toBe('blank')
  })

  it('keeps a box that fits where it is, but not past the right edge', () => {
    expect(planFit({ x: 10, y: 10, width: 200 }, page, area)).toEqual({
      kind: 'fits',
      width: 200,
      y: 10
    })
    expect(planFit({ x: 400, y: 10, width: 400 }, page, area)).toEqual({
      kind: 'fits',
      width: 217,
      y: 10
    })
  })
})

describe('placeFitted', () => {
  const box: TextBox = { id: 't_1', x: 500, y: 300, width: 100, markdown: 'Long', author: 'me' }
  const pages: AnnotationPages = {
    '3': { strokes: [], highlights: [], textBoxes: [box] },
    '3.1': { strokes: [], highlights: [], textBoxes: [{ ...box, id: 't_2' }], blank: true }
  }

  it('puts the box on a new blank page right below the slide', () => {
    const plan = planFit(box, page, (width) => 120_000 / width)
    const next = placeFitted(pages, 3, box, plan, page)
    expect(next['3']).toBeUndefined()
    expect(next['3.1'].textBoxes).toEqual([{ ...box, x: 8, y: 8, width: 609 }])
    expect(next['3.2'].textBoxes[0].id).toBe('t_2')
  })

  it('widens and moves up a box that fits that way', () => {
    const next = placeFitted(pages, 3, box, { kind: 'fits', width: 117, y: 136 }, page)
    expect(next['3'].textBoxes[0]).toMatchObject({ width: 117, y: 136 })
  })
})
