import type { ChatImage } from '../../../shared/claude'
import type { CaptureRect } from '../../../shared/types'

/** Claude scales larger images down to about this on the long side anyway. */
const MAX_SIDE = 1568

export interface Shot {
  image: ChatImage
  width: number
  height: number
  /** Pixels in the image per CSS pixel of the element. */
  scale: number
}

// The timeout keeps this going when Windows stops drawing a window that is fully covered.
const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
    setTimeout(resolve, 100)
  })

/** Waits a few frames until `test` passes, at most `ms`. */
export async function until(test: () => boolean, ms = 3000): Promise<boolean> {
  const end = performance.now() + ms
  while (!test()) {
    if (performance.now() > end) return false
    await frame()
  }
  return true
}

function intersect(a: CaptureRect, b: CaptureRect): CaptureRect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/** The part of a scroll container that shows its content, without the scrollbars. */
export function viewOf(scroller: HTMLElement): CaptureRect {
  const r = scroller.getBoundingClientRect()
  return {
    x: r.left + scroller.clientLeft,
    y: r.top + scroller.clientTop,
    width: scroller.clientWidth,
    height: scroller.clientHeight
  }
}

async function capture(rect: CaptureRect | null): Promise<ImageBitmap> {
  const png = await window.api.app.capture(rect)
  return createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
}

async function toShot(canvas: HTMLCanvasElement, scale: number): Promise<Shot> {
  const shrink = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height))
  let out = canvas
  if (shrink < 1) {
    out = document.createElement('canvas')
    out.width = Math.round(canvas.width * shrink)
    out.height = Math.round(canvas.height * shrink)
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(canvas, 0, 0, out.width, out.height)
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not create the image')
  return {
    image: { mediaType: 'image/png', data: new Uint8Array(await blob.arrayBuffer()) },
    width: out.width,
    height: out.height,
    scale: scale * shrink
  }
}

/** Part of the window, or all of it without a rect, as it is drawn now. */
export async function captureArea(rect: CaptureRect | null): Promise<Shot> {
  const bitmap = await capture(rect)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return toShot(canvas, bitmap.width / (rect?.width ?? window.innerWidth))
}

/**
 * An element as it is drawn in the app, all of it: when it is bigger than the view of
 * `scroller`, that scrolls over it and the pieces are put together. `ready` says when what
 * just scrolled into view is drawn. Ends with the element's top in view.
 */
export async function captureElement(
  el: HTMLElement,
  scroller: HTMLElement,
  ready: () => boolean
): Promise<Shot> {
  const view = viewOf(scroller)
  const start = el.getBoundingClientRect()
  const top = start.top - view.y + scroller.scrollTop
  const left = start.left - view.x + scroller.scrollLeft
  let canvas: HTMLCanvasElement | null = null
  let scale = 1
  for (let dy = 0; dy < start.height; dy += view.height) {
    for (let dx = 0; dx < start.width; dx += view.width) {
      scroller.scrollTop = top + dy
      scroller.scrollLeft = left + dx
      await frame()
      await until(ready)
      // Once more, so what was just drawn is on screen.
      await frame()
      const r = el.getBoundingClientRect()
      const clip = intersect({ x: r.left, y: r.top, width: r.width, height: r.height }, view)
      if (!clip.width || !clip.height) continue
      const bitmap = await capture(clip)
      if (!canvas) {
        scale = bitmap.width / clip.width
        canvas = document.createElement('canvas')
        canvas.width = Math.round(r.width * scale)
        canvas.height = Math.round(r.height * scale)
      }
      canvas
        .getContext('2d')!
        .drawImage(
          bitmap,
          Math.round((clip.x - r.left) * scale),
          Math.round((clip.y - r.top) * scale)
        )
    }
  }
  scroller.scrollTop = top - 8
  scroller.scrollLeft = left
  if (!canvas) throw new Error('It is not on screen')
  return toShot(canvas, scale)
}
