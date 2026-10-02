import { describe, expect, it } from 'vitest'
import type { PageAnnotations, TextBox } from '../../../shared/annotations'
import { marginSlot } from './margin'

const box = (x: number, y: number, markdown: string): TextBox => ({
  id: `t_${x}_${y}`,
  x,
  y,
  width: 300,
  fontSize: 13,
  markdown,
  author: 'me'
})

const page = (textBoxes: TextBox[]): PageAnnotations => ({ strokes: [], highlights: [], textBoxes })

// A 625-point wide page has pageUnit 1, so sizes are the screen-pixel values.
describe('marginSlot', () => {
  it('starts at the top of an empty margin, spanning its width', () => {
    expect(marginSlot(page([]), 625, 469, 0.6)).toEqual({ x: 633, y: 8, width: 359, fontSize: 13 })
  })

  it('goes under the notes already in the margin and ignores boxes on the slide', () => {
    const slot = marginSlot(
      page([box(640, 20, 'one line'), box(100, 300, 'on the slide')]),
      625,
      469,
      0.6
    )
    expect(slot.y).toBeGreaterThan(20 + 13)
    expect(slot.y).toBeLessThan(100)
  })

  it('stays on the page when the margin is full', () => {
    const full = page([box(640, 400, 'a\nb\nc\nd')])
    expect(marginSlot(full, 625, 469, 0.6).y).toBe(469 - 4 * 13)
  })
})
