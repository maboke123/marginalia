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
  it('moves text that cannot fit to a blank page, using its whole width', () => {
    expect(planFit({ x: 500, y: 300, width: 100 }, page, area)).toEqual({
      kind: 'blank',
      x: 8,
      y: 8,
      width: 609
    })
  })

  it('keeps a box that fits where it is', () => {
    expect(planFit({ x: 10, y: 10, width: 200 }, page, area)).toEqual({ kind: 'fits', width: 200 })
  })
})

describe('placeFitted', () => {
  const box: TextBox = { id: 't_1', x: 500, y: 300, width: 100, markdown: 'Long', author: 'me' }
  const pages: AnnotationPages = {
    '3': { strokes: [], highlights: [], textBoxes: [box] },
    '3.1': { strokes: [], highlights: [], textBoxes: [{ ...box, id: 't_2' }], blank: true }
  }

  it('puts the box on a new blank page right below the slide', () => {
    const plan = planFit(box, page, area)
    const next = placeFitted(pages, 3, box, plan, page)
    expect(next['3']).toBeUndefined()
    expect(next['3.1'].textBoxes).toEqual([{ ...box, x: 8, y: 8, width: 609 }])
    expect(next['3.2'].textBoxes[0].id).toBe('t_2')
  })

  it('widens a box that fits once it is wider', () => {
    const next = placeFitted(pages, 3, box, { kind: 'fits', width: 117 }, page)
    expect(next['3'].textBoxes[0].width).toBe(117)
  })
})
