import type { PDFDocumentProxy } from 'pdfjs-dist'

/** Sharp enough to read small formulas when the image is shown at full width in a note. */
const SNAPSHOT_SCALE = 3

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
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * SNAPSHOT_SCALE))
  canvas.height = Math.max(1, Math.round(height * SNAPSHOT_SCALE))
  await page.render({ canvas, viewport }).promise
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image')
  return new Uint8Array(await blob.arrayBuffer())
}
