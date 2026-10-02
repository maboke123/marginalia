import { describe, expect, it } from 'vitest'
import {
  PAGE_GAP,
  VIEW_PADDING,
  fitWidthScale,
  layoutPages,
  mostVisiblePage,
  pagesBetween,
  stepZoom
} from './layout'

// A 16:9 slide deck as exported from PowerPoint: 960 x 540 points.
const slides = Array.from({ length: 120 }, () => ({ width: 960, height: 540 }))

describe('layoutPages', () => {
  it('stacks pages with a gap and padding', () => {
    const layout = layoutPages(slides.slice(0, 3), 0.5)

    expect(layout.tops).toEqual([
      VIEW_PADDING,
      VIEW_PADDING + 270 + PAGE_GAP,
      VIEW_PADDING + 2 * (270 + PAGE_GAP)
    ])
    expect(layout.heights).toEqual([270, 270, 270])
    expect(layout.totalHeight).toBe(2 * VIEW_PADDING + 3 * 270 + 2 * PAGE_GAP)
    expect(layout.maxWidth).toBe(480)
  })

  it('handles an empty document', () => {
    expect(layoutPages([], 1).totalHeight).toBe(0)
    expect(pagesBetween(layoutPages([], 1), 0, 500)).toEqual([0, -1])
  })
})

describe('fitWidthScale', () => {
  it('fits the widest page inside the padding', () => {
    expect(fitWidthScale(slides, 960 + 2 * VIEW_PADDING)).toBe(1)
    expect(
      fitWidthScale(
        [
          { width: 600, height: 800 },
          { width: 1200, height: 800 }
        ],
        648
      )
    ).toBe(0.5)
  })
})

describe('pagesBetween', () => {
  it('finds the pages overlapping a band', () => {
    const layout = layoutPages(slides, 1)
    const page = 540 + PAGE_GAP

    expect(pagesBetween(layout, 0, 800)).toEqual([0, 1])
    expect(pagesBetween(layout, VIEW_PADDING + 40 * page, VIEW_PADDING + 40 * page + 10)).toEqual([
      40, 40
    ])
    expect(pagesBetween(layout, layout.totalHeight - 10, layout.totalHeight + 1000)).toEqual([
      119, 119
    ])
  })
})

describe('mostVisiblePage', () => {
  const layout = layoutPages(slides, 1)
  const page = 540 + PAGE_GAP

  it('picks the page that fills most of the view', () => {
    expect(mostVisiblePage(layout, 0, 800)).toBe(1)
    // Scrolled so that page 32 covers the view almost entirely.
    expect(mostVisiblePage(layout, VIEW_PADDING + 31 * page - 20, 600)).toBe(32)
  })

  it('switches once the next page shows more', () => {
    const top = VIEW_PADDING + 9 * page
    expect(mostVisiblePage(layout, top + 200, 600)).toBe(10)
    expect(mostVisiblePage(layout, top + 300, 600)).toBe(11)
  })
})

describe('stepZoom', () => {
  it('moves between round zoom levels', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(0.73, 1)).toBe(0.8)
    expect(stepZoom(0.73, -1)).toBe(0.67)
    expect(stepZoom(5, 1)).toBe(5)
  })
})
