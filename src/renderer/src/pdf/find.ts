import type { PDFDocumentProxy } from 'pdfjs-dist'
import { create } from 'zustand'
import type { AnnotationPages } from '../../../shared/annotations'
import type { ViewPage } from '../../../shared/blankPages'
import { markdownToText } from '../../../shared/plainText'
import { pageOf } from '../annotations/doc'
import { containsText, findAllTextRects, type TextRun } from '../annotations/findText'
import type { Rect } from '../annotations/geometry'
import { pageRuns } from './text'

/** A place Ctrl+F found: words on a slide, or a text box (`box`) that contains them. */
export interface FindHit {
  page: number
  rects: Rect[]
  box?: string
}

interface FindState {
  /** The PDF the hits belong to. */
  path: string | null
  hits: FindHit[]
  current: number
}

export const useFind = create<FindState>(() => ({ path: null, hits: [], current: -1 }))

// Reading the text of every page takes a moment on a long PDF; the next search reuses it.
const runCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextRun[]>>>()

function runsOf(pdf: PDFDocumentProxy, page: number): Promise<TextRun[]> {
  let pages = runCache.get(pdf)
  if (!pages) runCache.set(pdf, (pages = new Map()))
  let runs = pages.get(page)
  if (!runs) pages.set(page, (runs = pageRuns(pdf, page)))
  return runs
}

/** Every place `query` is on the slides or in my text boxes, in the order of the view. */
export async function findInPdf(
  pdf: PDFDocumentProxy,
  views: ViewPage[],
  pages: AnnotationPages,
  query: string
): Promise<FindHit[]> {
  const hits: FindHit[] = []
  for (const view of views) {
    const found: FindHit[] = []
    if (view.pdfPage !== null) {
      for (const rects of findAllTextRects(await runsOf(pdf, view.pdfPage), query)) {
        found.push({ page: view.id, rects })
      }
    }
    for (const box of pageOf(pages, view.id).textBoxes) {
      if (containsText(markdownToText(box.markdown), query)) {
        found.push({ page: view.id, rects: [[box.x, box.y, box.width, 0]], box: box.id })
      }
    }
    found.sort((a, b) => a.rects[0][1] - b.rects[0][1] || a.rects[0][0] - b.rects[0][0])
    hits.push(...found)
  }
  return hits
}
