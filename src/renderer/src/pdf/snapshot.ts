import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'

/** Sharp enough to read small formulas when the image is shown at full width in a note. */
const SNAPSHOT_SCALE = 3

async function toPng(
  page: PDFPageProxy,
  viewport: PageViewport,
  width: number,
  height: number
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  await page.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Renders part of a page, given in page points [x, y, width, height], to PNG bytes. */
export async function renderRegion(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  [x, y, width, height]: [number, number, number, number]
): Promise<Uint8Array> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({
    scale: SNAPSHOT_SCALE,
    offsetX: -x * SNAPSHOT_SCALE,
    offsetY: -y * SNAPSHOT_SCALE
  })
  return toPng(page, viewport, width * SNAPSHOT_SCALE, height * SNAPSHOT_SCALE)
}

/**
 * A whole page for Claude to look at. About 1280 pixels on the long side keeps formulas
 * readable while costing a predictable number of image tokens.
 */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  longEdge = 1280
): Promise<Uint8Array> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: longEdge / Math.max(base.width, base.height) })
  return toPng(page, viewport, viewport.width, viewport.height)
}
