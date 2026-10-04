import { describe, expect, it } from 'vitest'
import type { AnnotationPages, PageAnnotations } from './annotations'
import { insertBlankPage, removeBlankPage, viewPages } from './blankPages'

const note = (markdown: string, blank = true): PageAnnotations => ({
  strokes: [],
  highlights: [],
  textBoxes: [{ id: markdown, x: 0, y: 0, width: 100, markdown, author: 'me' }],
  ...(blank && { blank: true })
})
const texts = (pages: AnnotationPages): Record<string, string> =>
  Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.textBoxes[0]?.markdown ?? '']))

describe('blank pages', () => {
  it('come right after their slide in the viewer', () => {
    const pages = {
      '2': note('slide', false),
      '2.1': note('a'),
      '2.2': note('b'),
      '3.1': note('c')
    }
    expect(viewPages(3, pages).map((v) => [v.id, v.pdfPage])).toEqual([
      [1, 1],
      [2, 2],
      [2.1, null],
      [2.2, null],
      [3, 3],
      [3.1, null]
    ])
  })

  it('go right below the page they are added under, pushing later ones down', () => {
    const start = { '2.1': note('a'), '2.2': note('b') }
    const first = insertBlankPage(start, 2)!
    expect(first.id).toBe(2.1)
    expect(texts(first.pages)).toEqual({ '2.1': '', '2.2': 'a', '2.3': 'b' })
    expect(first.pages['2.1'].blank).toBe(true)

    const between = insertBlankPage(start, 2.1)!
    expect(between.id).toBe(2.2)
    expect(texts(between.pages)).toEqual({ '2.1': 'a', '2.2': '', '2.3': 'b' })
  })

  it('removing one moves the later ones up with what is on them', () => {
    const pages = {
      '2': note('slide', false),
      '2.1': note('a'),
      '2.2': note('b'),
      '2.3': note('c')
    }
    expect(texts(removeBlankPage(pages, 2.1))).toEqual({ '2': 'slide', '2.1': 'b', '2.2': 'c' })
    expect(removeBlankPage(pages, 2)).toBe(pages)
  })

  it('stop at nine per slide', () => {
    let pages: AnnotationPages = {}
    for (let i = 0; i < 9; i++) pages = insertBlankPage(pages, 4)!.pages
    expect(Object.keys(pages).sort()).toEqual(
      ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9'].sort()
    )
    expect(insertBlankPage(pages, 4)).toBeNull()
  })
})
