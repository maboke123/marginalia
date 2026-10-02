/**
 * The `<name>.pdf.annotations.json` sidecar (SPEC section 4).
 * Coordinates are PDF points at scale 1 with the origin at the top-left of the page.
 * `x` may go past the page width, up to width * (1 + marginWidth): that is the margin.
 */

export type Author = 'me' | 'claude'

export interface Stroke {
  id: string
  tool: 'pen' | 'highlighter'
  color: string
  width: number
  /** [x, y, pressure] */
  points: [number, number, number][]
  author: Author
}

export type TextMarkup = 'highlight' | 'underline' | 'strikethrough'

/** Marked-up PDF text. Without `style` it is a highlight, like in SPEC section 4. */
export interface Highlight {
  id: string
  color: string
  style?: TextMarkup
  text: string
  /** [x, y, width, height] */
  rects: [number, number, number, number][]
  author: Author
}

export interface TextBox {
  id: string
  x: number
  y: number
  width: number
  /** In points; older files without it use the default size. */
  fontSize?: number
  markdown: string
  author: Author
}

export interface PageAnnotations {
  strokes: Stroke[]
  highlights: Highlight[]
  textBoxes: TextBox[]
}

/** Keyed by 1-based page number as a string, like the JSON file. */
export type AnnotationPages = Record<string, PageAnnotations>

export interface AnnotationFile {
  version: 1
  pdf: string
  pdfSha256: string
  marginWidth: number
  pages: AnnotationPages
}

export interface LoadedAnnotations {
  /** null when the PDF has no sidecar yet. */
  file: AnnotationFile | null
  /** Hash of the PDF as it is on disk now; differs from `file.pdfSha256` if the PDF was replaced. */
  pdfSha256: string
}

export const EMPTY_PAGE: PageAnnotations = Object.freeze({
  strokes: [],
  highlights: [],
  textBoxes: []
}) as PageAnnotations
