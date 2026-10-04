import type { AnnotationPages, PageAnnotations } from './annotations'

/**
 * Blank pages I add below a slide (for notes that do not fit) live in the sidecar like any
 * page, under the keys "3.1", "3.2", ...: slide 3, then its first and second blank page.
 * The PDF itself is never changed. As numbers these keys work wherever a page number does.
 */
export const MAX_BLANKS_PER_SLIDE = 9

export const slideOf = (page: number): number => Math.floor(page)
export const isBlankPage = (page: number): boolean => !Number.isInteger(page)
const blankIndex = (page: number): number => Math.round((page - slideOf(page)) * 10)
const blankKey = (slide: number, index: number): string => `${slide}.${index}`

/** One page in the viewer: a PDF page, or a blank page that shows no PDF page. */
export interface ViewPage {
  /** Page key: 3 for slide 3, 3.1 for the first blank page after it. */
  id: number
  /** The PDF page to draw, null for a blank page. */
  pdfPage: number | null
}

/** Blank page keys after one slide, in order. */
function blanksAfter(pages: Record<string, unknown>, slide: number): number[] {
  return Object.keys(pages)
    .map(Number)
    .filter((p) => isBlankPage(p) && slideOf(p) === slide)
    .sort((a, b) => a - b)
}

/** Every page of the PDF in order, each followed by the blank pages added after it. */
export function viewPages(pageCount: number, pages: Record<string, unknown>): ViewPage[] {
  const views: ViewPage[] = []
  for (let n = 1; n <= pageCount; n++) {
    views.push({ id: n, pdfPage: n })
    for (const id of blanksAfter(pages, n)) views.push({ id, pdfPage: null })
  }
  return views
}

const emptyBlank = (): PageAnnotations => ({
  strokes: [],
  highlights: [],
  textBoxes: [],
  blank: true
})

/**
 * Adds a blank page right below `below` (a slide or a blank page); later blank pages of that
 * slide move one down. Null when the slide already has the most blank pages allowed.
 */
export function insertBlankPage(
  pages: AnnotationPages,
  below: number
): { pages: AnnotationPages; id: number } | null {
  const slide = slideOf(below)
  const existing = blanksAfter(pages, slide)
  if (existing.length >= MAX_BLANKS_PER_SLIDE) return null
  const at = (isBlankPage(below) ? blankIndex(below) : 0) + 1
  const next = { ...pages }
  for (const id of [...existing].reverse()) {
    const index = blankIndex(id)
    if (index < at) continue
    next[blankKey(slide, index + 1)] = pages[blankKey(slide, index)]
    delete next[blankKey(slide, index)]
  }
  next[blankKey(slide, at)] = emptyBlank()
  return { pages: next, id: Number(blankKey(slide, at)) }
}

/** Removes a blank page with what is on it; the blank pages after it move one up. */
export function removeBlankPage(pages: AnnotationPages, id: number): AnnotationPages {
  if (!isBlankPage(id)) return pages
  const slide = slideOf(id)
  const removed = blankIndex(id)
  const next = { ...pages }
  delete next[blankKey(slide, removed)]
  for (const other of blanksAfter(pages, slide)) {
    const index = blankIndex(other)
    if (index <= removed) continue
    next[blankKey(slide, index - 1)] = pages[blankKey(slide, index)]
    delete next[blankKey(slide, index)]
  }
  return next
}
