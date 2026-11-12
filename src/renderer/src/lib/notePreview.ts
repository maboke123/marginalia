import type { ChatImage } from '../../../shared/claude'
import { toShot } from '../claude/screenshot'
import { loadPdf } from '../pdf/pdfjs'
import { flushAll } from './flush'
import { pageHtmlOf } from './notePdf'

/** The PDF that Export as PDF would write for this note or canvas, as it is saved now. */
export async function printNote(path: string): Promise<Uint8Array> {
  await flushAll()
  return window.api.vault.printNote(await pageHtmlOf(path))
}

/** Pages of a PDF drawn `width` pixels wide: all of them, or only the numbers in `only`. */
export async function drawPages(
  data: Uint8Array,
  width: number,
  only?: number[]
): Promise<HTMLCanvasElement[]> {
  const task = loadPdf(data)
  try {
    const pdf = await task.promise
    const canvases: HTMLCanvasElement[] = []
    const numbers = only ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
    for (const n of numbers.filter((n) => n >= 1 && n <= pdf.numPages)) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      canvases.push(canvas)
    }
    return canvases
  } finally {
    void task.destroy()
  }
}

/** Pages next to each other in rows, on a gray sheet, as one picture. */
export async function contactSheet(
  pages: HTMLCanvasElement[],
  columns: number
): Promise<ChatImage> {
  const gap = 16
  const { width, height } = pages[0]
  const rows = Math.ceil(pages.length / columns)
  const sheet = document.createElement('canvas')
  sheet.width = columns * width + (columns + 1) * gap
  sheet.height = rows * height + (rows + 1) * gap
  const ctx = sheet.getContext('2d')!
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas')
  ctx.fillRect(0, 0, sheet.width, sheet.height)
  pages.forEach((page, i) => {
    const x = gap + (i % columns) * (width + gap)
    const y = gap + Math.floor(i / columns) * (height + gap)
    ctx.drawImage(page, x, y, width, height)
  })
  return (await toShot(sheet, 1)).image
}

export async function pageImage(page: HTMLCanvasElement): Promise<ChatImage> {
  return (await toShot(page, 1)).image
}
