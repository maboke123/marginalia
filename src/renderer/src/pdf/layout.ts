/** Page size in PDF points at scale 1, the unit annotations are stored in. */
export interface PageSize {
  width: number
  height: number
}

export interface Layout {
  tops: number[]
  heights: number[]
  /** Width of each page including its margin, in screen pixels. */
  widths: number[]
  totalHeight: number
  maxWidth: number
}

export const PAGE_GAP = 16
export const VIEW_PADDING = 24
export const MIN_SCALE = 0.25
export const MAX_SCALE = 5

const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** The next preset zoom level above or below `scale`, so zooming from "fit" lands on round numbers. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? ZOOM_STEPS.find((s) => s > scale + 0.001)
      : [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001)
  return next ?? clampScale(scale)
}

/** `margin` is the margin next to each page as a fraction of the page width (0.6 = 60%). */
export function fitWidthScale(sizes: PageSize[], containerWidth: number, margin = 0): number {
  const widest = Math.max(...sizes.map((s) => s.width)) * (1 + margin)
  if (!Number.isFinite(widest) || widest <= 0) return 1
  return clampScale((containerWidth - 2 * VIEW_PADDING) / widest)
}

export function layoutPages(sizes: PageSize[], scale: number, margin = 0): Layout {
  const tops: number[] = []
  const heights: number[] = []
  const widths: number[] = []
  let y = VIEW_PADDING
  for (const size of sizes) {
    const height = Math.round(size.height * scale)
    tops.push(y)
    heights.push(height)
    widths.push(Math.round(size.width * (1 + margin) * scale))
    y += height + PAGE_GAP
  }
  return {
    tops,
    heights,
    widths,
    totalHeight: sizes.length ? y - PAGE_GAP + VIEW_PADDING : 0,
    maxWidth: Math.max(0, ...widths)
  }
}

/** Index of the first page whose bottom edge is below `y`. */
function firstPageEndingAfter(layout: Layout, y: number): number {
  let lo = 0
  let hi = layout.tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (layout.tops[mid] + layout.heights[mid] <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Pages (0-based, inclusive) that overlap the band from `top` to `bottom`. */
export function pagesBetween(layout: Layout, top: number, bottom: number): [number, number] {
  const count = layout.tops.length
  if (count === 0) return [0, -1]
  const first = firstPageEndingAfter(layout, top)
  let last = first
  while (last + 1 < count && layout.tops[last + 1] < bottom) last++
  return [first, last]
}

/** The page (1-based) with the most visible area; ties go to the page higher up. */
export function mostVisiblePage(layout: Layout, scrollTop: number, viewHeight: number): number {
  const bottom = scrollTop + viewHeight
  const [first, last] = pagesBetween(layout, scrollTop, bottom)
  let best = first
  let bestArea = -1
  for (let i = first; i <= last; i++) {
    const top = layout.tops[i]
    const visible = Math.min(top + layout.heights[i], bottom) - Math.max(top, scrollTop)
    const area = visible * layout.widths[i]
    if (area > bestArea) {
      best = i
      bestArea = area
    }
  }
  return best + 1
}
