import { describe, expect, it } from 'vitest'
import {
  closePane,
  dropSide,
  gridOf,
  moveBorder,
  openInGrid,
  paneRects,
  remapGrid,
  resizeGrid,
  sideOf,
  splitPane
} from './grid'

describe('grid', () => {
  it('starts with what was open and fills the focused pane', () => {
    const grid = resizeGrid(null, 3, ['ML/slides.pdf', 'ML/Summary.md'])
    expect(grid.panes).toEqual(['ML/slides.pdf', 'ML/Summary.md', null])
    expect(grid.focus).toBe(0)
    expect(openInGrid({ ...grid, focus: 2 }, 'DSS/Shop.canvas').panes[2]).toBe('DSS/Shop.canvas')
  })

  it('focuses a file that is already open instead of opening it twice', () => {
    const grid = gridOf(['a.pdf', 'b.md'])
    expect(openInGrid(grid, 'b.md')).toMatchObject({ panes: ['a.pdf', 'b.md'], focus: 1 })
  })

  it('keeps the focused file when it shrinks, and grows with empty panes', () => {
    // Two by two reads a, b on top and c, d below.
    const four = { ...resizeGrid(null, 4, ['a.pdf', 'b.md', 'c.canvas', 'd.md']) }
    expect(paneRects(four)[four.panes.indexOf('b.md')]).toMatchObject({ left: 0.5, top: 0 })
    const shrunk = resizeGrid({ ...four, focus: four.panes.indexOf('d.md') }, 2)
    expect(shrunk).toMatchObject({ panes: ['a.pdf', 'd.md'], focus: 1 })
    const grown = resizeGrid({ ...gridOf(['a.pdf', 'b.md']), focus: 1 }, 4)
    // What was next to each other stays next to each other.
    expect(paneRects(grown)[grown.panes.indexOf('b.md')]).toMatchObject({ left: 0.5, top: 0 })
    expect(grown.panes[grown.focus]).toBe('b.md')
  })

  it('follows renames and empties panes of files that are gone', () => {
    const grid = gridOf(['ML/a.pdf', 'ML/b.md'])
    const map = (p: string): string | null => (p === 'ML/b.md' ? null : p.replace('ML/', 'AI/'))
    expect(remapGrid(grid, map).panes).toEqual(['AI/a.pdf', null])
  })
})

describe('closePane', () => {
  it('gives a closed column its room to the others', () => {
    const grid = { ...gridOf(['a.pdf', 'b.md', 'c.md'], [0.5, 0.25, 0.25]), focus: 2 }
    const closed = closePane(grid, 0)
    expect(closed.panes).toEqual(['b.md', 'c.md'])
    expect(closed.widths).toEqual([0.5, 0.5])
    expect(closed.focus).toBe(1)
  })

  it('lets the pane above or below fill a stacked column', () => {
    const four = resizeGrid(null, 4, ['a.pdf', 'b.md', 'c.md', 'd.md'])
    const closed = closePane(four, four.panes.indexOf('d.md'))
    expect(closed.columns).toEqual([2, 1])
    const b = paneRects(closed)[closed.panes.indexOf('b.md')]
    expect(b).toEqual({ left: 0.5, top: 0, width: 0.5, height: 1 })
  })
})

describe('splitPane', () => {
  it('puts a file left or right of a pane, which gives up half its width', () => {
    const grid = splitPane(gridOf(['a.pdf']), 0, 'right', 'b.md')!
    expect(grid).toMatchObject({ panes: ['a.pdf', 'b.md'], widths: [0.5, 0.5], focus: 1 })
    const three = splitPane(grid, 1, 'left', 'c.md')!
    expect(three.panes).toEqual(['a.pdf', 'c.md', 'b.md'])
    expect(three.widths).toEqual([0.5, 0.25, 0.25])
  })

  it('stacks a file above or below a pane', () => {
    const grid = splitPane(gridOf(['a.pdf', 'b.md']), 1, 'bottom', 'c.md')!
    expect(grid.columns).toEqual([1, 2])
    expect(paneRects(grid)[2]).toEqual({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 })
    const top = splitPane(grid, 0, 'top', 'd.md')!
    expect(top.panes).toEqual(['d.md', 'a.pdf', 'b.md', 'c.md'])
  })

  it('moves a file that is already shown, and refuses a fifth pane', () => {
    const grid = gridOf(['a.pdf', 'b.md', 'c.md'])
    const moved = splitPane(grid, 0, 'bottom', 'c.md')!
    expect(moved.panes).toEqual(['a.pdf', 'c.md', 'b.md'])
    expect(moved.columns).toEqual([2, 1])
    const full = splitPane(moved, 0, 'right', 'd.md')!
    expect(splitPane(full, 0, 'right', 'e.md')).toBeNull()
  })
})

describe('moveBorder', () => {
  it('moves one border and keeps both panes at least a tenth wide', () => {
    const moved = moveBorder([0.5, 0.25, 0.25], 0, 0.1)
    expect(moved[0]).toBeCloseTo(0.6)
    expect(moved[1]).toBeCloseTo(0.15)
    expect(moved[2]).toBe(0.25)
    expect(moveBorder([0.5, 0.5], 0, 0.6)[1]).toBeCloseTo(0.1)
    expect(moveBorder([0.5, 0.5], 0, -0.6)[0]).toBeCloseTo(0.1)
  })
})

describe('dropSide', () => {
  it('takes the nearest edge in the outer quarter, else the middle', () => {
    expect(dropSide(0.1, 0.5)).toBe('left')
    expect(dropSide(0.9, 0.3)).toBe('right')
    expect(dropSide(0.5, 0.95)).toBe('bottom')
    expect(dropSide(0.5, 0.5)).toBe('center')
    expect(sideOf({ left: 0.5, top: 0, width: 0.5, height: 1 }, 'bottom')).toEqual({
      left: 0.5,
      top: 0.5,
      width: 0.5,
      height: 0.5
    })
  })
})
