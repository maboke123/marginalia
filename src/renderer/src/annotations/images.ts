import type { PageAnnotations, PageImage } from '../../../shared/annotations'
import { pageUnit } from '../../../shared/palette'
import { round, type Point } from './geometry'
import { marginBottom } from './margin'

/** The image types pdf-lib can embed, so an exported PDF always has every image. */
export const PAGE_IMAGE_TYPES: Record<string, 'png' | 'jpg'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg'
}

/** CSS pixels to points: a screenshot shows at its real size at 100% zoom. */
const POINTS_PER_PIXEL = 0.75

interface PageBox {
  width: number
  height: number
  margin: number
}

/**
 * Where a new image goes. At `at` (where I clicked or dropped) when given, else in the margin
 * under what is there already, else in the middle of the slide. Never wider than the space it
 * lands in nor taller than the page; the aspect ratio stays.
 */
export function placeImage(
  natural: { width: number; height: number },
  page: PageBox,
  annotations: PageAnnotations,
  at: Point | null
): Pick<PageImage, 'x' | 'y' | 'width' | 'height'> {
  const unit = pageUnit(page.width)
  const gap = 8 * unit
  const total = page.width * (1 + page.margin)
  const ratio = natural.height / natural.width
  let width = natural.width * POINTS_PER_PIXEL
  let x: number
  let y: number
  if (at) {
    x = Math.min(at[0], total - 60 * unit)
    y = at[1]
    width = Math.min(width, total - x - gap / 2)
  } else if (page.margin > 0) {
    x = page.width + gap
    y = marginBottom(annotations, page.width) ?? gap
    width = Math.min(width, page.width * page.margin - 2 * gap)
  } else {
    width = Math.min(width, page.width / 2)
    x = (page.width - width) / 2
    y = gap
  }
  width = Math.max(1, Math.min(width, (page.height - 2 * gap) / ratio))
  const height = width * ratio
  y = Math.max(0, Math.min(y, page.height - height))
  return { x: round(x), y: round(y), width: round(width), height: round(height) }
}

/** Size after dragging the corner by dx: the aspect ratio stays, and it never gets tiny. */
export function resizeImage(image: PageImage, dx: number, minWidth: number): PageImage {
  const width = Math.max(minWidth, image.width + dx)
  return { ...image, width: round(width), height: round((width * image.height) / image.width) }
}

/** Vault path of an image on a page of `pdf`. */
export function imagePath(pdf: string, src: string): string {
  const folder = pdf.slice(0, pdf.lastIndexOf('/') + 1)
  return folder + src
}
