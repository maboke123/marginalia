import { describe, expect, it } from 'vitest'
import { findTextRects, type TextRun } from './findText'

// Two lines of 10-point text; every character is 5 points wide.
const run = (str: string, x: number, y: number): TextRun => ({
  str,
  x,
  y,
  width: str.length * 5,
  height: 10
})

const RUNS = [
  run('Choosing a test: infor', 50, 100),
  run('mation gain', 160, 100),
  run('picks the split with', 50, 114),
  run('the largest ﬁnal gain', 50, 128)
]

describe('findTextRects', () => {
  it('finds a phrase split over runs on one line', () => {
    expect(findTextRects(RUNS, 'Information gain')).toEqual([[135, 100, 80, 10]])
  })

  it('returns one rectangle per line for text over two lines', () => {
    expect(findTextRects(RUNS, 'split with the largest')).toEqual([
      [100, 114, 50, 10],
      [50, 128, 55, 10]
    ])
  })

  it('ignores case, spacing and ligatures', () => {
    expect(findTextRects(RUNS, 'FINAL   gain')).toEqual([[110, 128, 45, 10]])
  })

  it('returns null when the text is not on the page', () => {
    expect(findTextRects(RUNS, 'entropy')).toBeNull()
    expect(findTextRects(RUNS, '   ')).toBeNull()
  })
})
