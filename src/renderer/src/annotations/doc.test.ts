import { describe, expect, it } from 'vitest'
import type { AnnotationPages, TextBox } from '../../../shared/annotations'
import { moveToPage } from './doc'

const box: TextBox = { id: 't_1', x: 40, y: 500, width: 180, markdown: 'Pivot', author: 'me' }
const pages: AnnotationPages = {
  '3': { strokes: [], highlights: [], textBoxes: [box] },
  '3.1': { strokes: [], highlights: [], textBoxes: [], blank: true }
}

describe('moveToPage', () => {
  it('moves a box to another page and drops the page it leaves empty', () => {
    const next = moveToPage(pages, { page: 3, kind: 'textBoxes', id: 't_1' }, 3.1, (b) => ({
      ...b,
      y: 20
    }))
    expect(next['3']).toBeUndefined()
    expect(next['3.1'].textBoxes).toEqual([{ ...box, y: 20 }])
    expect(next['3.1'].blank).toBe(true)
  })

  it('leaves the pages alone for an unknown item or the same page', () => {
    const place = (b: TextBox): TextBox => b
    expect(moveToPage(pages, { page: 3, kind: 'textBoxes', id: 'nope' }, 4, place)).toBe(pages)
    expect(moveToPage(pages, { page: 3, kind: 'textBoxes', id: 't_1' }, 3, place)).toBe(pages)
  })
})
