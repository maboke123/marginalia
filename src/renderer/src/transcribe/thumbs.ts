import { THUMB_HEIGHT, THUMB_WIDTH, type SlideThumb } from '../../../shared/slideMatch'
import { loadPdf } from '../pdf/pdfjs'
import type { Candidate } from './candidates'

// Rendered larger and scaled down, like ffmpeg scales the video frames, so both blur alike.
const OVERSAMPLE = 3

/**
 * Every page of the candidate decks, small and gray, letterboxed on white the same way the
 * video's frames are (main's extractFrames).
 */
export async function slideThumbs(candidates: Candidate[]): Promise<SlideThumb[]> {
  const thumbs: SlideThumb[] = []
  const big = document.createElement('canvas')
  const small = document.createElement('canvas')
  small.width = THUMB_WIDTH
  small.height = THUMB_HEIGHT
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  for (const { pdf: path, group } of candidates) {
    const data = await window.api.vault.readFile(path).catch(() => null)
    if (!data) continue
    const task = loadPdf(data)
    try {
      const pdf = await task.promise
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const fit = Math.min(THUMB_WIDTH / base.width, THUMB_HEIGHT / base.height)
        const viewport = page.getViewport({ scale: fit * OVERSAMPLE })
        big.width = Math.ceil(viewport.width)
        big.height = Math.ceil(viewport.height)
        await page.render({ canvas: big, viewport }).promise
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT)
        const w = base.width * fit
        const h = base.height * fit
        ctx.drawImage(big, (THUMB_WIDTH - w) / 2, (THUMB_HEIGHT - h) / 2, w, h)
        const rgba = ctx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data
        const pixels = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT)
        for (let i = 0; i < pixels.length; i++) {
          pixels[i] = Math.round(
            0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
          )
        }
        thumbs.push({ pdf: path, page: n, group, pixels })
      }
    } finally {
      await task.destroy()
    }
  }
  return thumbs
}
