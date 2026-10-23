import { describe, expect, it } from 'vitest'
import { openInGrid, remapGrid, resizeGrid } from './grid'

describe('grid', () => {
  it('starts with what was open and fills the focused pane', () => {
    const grid = resizeGrid(null, 3, ['ML/slides.pdf', 'ML/Summary.md'])
    expect(grid).toEqual({ panes: ['ML/slides.pdf', 'ML/Summary.md', null], focus: 0 })
    expect(openInGrid({ ...grid, focus: 2 }, 'DSS/Shop.canvas').panes[2]).toBe('DSS/Shop.canvas')
  })

  it('focuses a file that is already open instead of opening it twice', () => {
    const grid = { panes: ['a.pdf', 'b.md'], focus: 0 }
    expect(openInGrid(grid, 'b.md')).toEqual({ panes: ['a.pdf', 'b.md'], focus: 1 })
  })

  it('keeps the focused file when it shrinks, and grows with empty panes', () => {
    const four = { panes: ['a.pdf', 'b.md', 'c.canvas', 'd.md'], focus: 3 }
    expect(resizeGrid(four, 2)).toEqual({ panes: ['a.pdf', 'd.md'], focus: 1 })
    expect(resizeGrid({ panes: ['a.pdf', 'b.md'], focus: 1 }, 4)).toEqual({
      panes: ['a.pdf', 'b.md', null, null],
      focus: 1
    })
  })

  it('follows renames and empties panes of files that are gone', () => {
    const grid = { panes: ['ML/a.pdf', 'ML/b.md'], focus: 0 }
    const map = (p: string): string | null => (p === 'ML/b.md' ? null : p.replace('ML/', 'AI/'))
    expect(remapGrid(grid, map).panes).toEqual(['AI/a.pdf', null])
  })
})
