import { describe, expect, it } from 'vitest'
import type { AnnotationPages, TextBox } from '../../../shared/annotations'
import { addItem, createAnnotationDoc, moveToPage, replaceItem } from './doc'

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

describe('change during a drag or typing', () => {
  const other: TextBox = { ...box, id: 't_2', y: 100, markdown: '' }

  it('keeps the change when the typing is cancelled', () => {
    const doc = createAnnotationDoc(pages)
    doc.getState().begin()
    doc.getState().update((p) => addItem(p, 3, 'textBoxes', other))
    doc.getState().change((p) => replaceItem(p, 3, 'textBoxes', { ...box, markdown: 'Answer' }))
    doc.getState().cancel()
    expect(doc.getState().pages['3'].textBoxes).toEqual([{ ...box, markdown: 'Answer' }])
    doc.getState().undo()
    expect(doc.getState().pages).toBe(pages)
  })

  it('makes the change and the typing two undo steps', () => {
    const doc = createAnnotationDoc(pages)
    doc.getState().begin()
    doc.getState().update((p) => addItem(p, 3, 'textBoxes', { ...other, markdown: 'Mine' }))
    doc.getState().change((p) => replaceItem(p, 3, 'textBoxes', { ...box, markdown: 'Answer' }))
    doc.getState().end()
    expect(doc.getState().pages['3'].textBoxes.map((b) => b.markdown)).toEqual(['Answer', 'Mine'])
    doc.getState().undo()
    expect(doc.getState().pages['3'].textBoxes.map((b) => b.markdown)).toEqual(['Answer'])
    doc.getState().undo()
    expect(doc.getState().pages).toBe(pages)
  })
})
