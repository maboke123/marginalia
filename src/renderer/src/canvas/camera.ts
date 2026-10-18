import type { Rect } from '../../../shared/canvas'

/** Where the view looks: the world point at the view's top left, and the zoom. */
export interface Camera {
  x: number
  y: number
  zoom: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
const STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export function toWorld(camera: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: camera.x + sx / camera.zoom, y: camera.y + sy / camera.zoom }
}

export function toScreen(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom }
}

/** Zooms with the world point under (sx, sy) staying under it. */
export function zoomAt(camera: Camera, zoom: number, sx: number, sy: number): Camera {
  const next = clampZoom(zoom)
  const at = toWorld(camera, sx, sy)
  return { x: at.x - sx / next, y: at.y - sy / next, zoom: next }
}

/** Ctrl+wheel and pinch: smooth, a notch of the wheel is about 20%. */
export const wheelZoom = (zoom: number, deltaY: number): number =>
  clampZoom(zoom * Math.exp(-deltaY * 0.002))

/** The zoom buttons and Ctrl+= / Ctrl+-: the next of a few round steps. */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return STEPS.find((s) => s > zoom + 0.001) ?? MAX_ZOOM
  return [...STEPS].reverse().find((s) => s < zoom - 0.001) ?? MIN_ZOOM
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx / camera.zoom, y: camera.y + dy / camera.zoom }
}

/** Shows all of `bounds` with a margin, at most at 100%. */
export function fitCamera(bounds: Rect | null, width: number, height: number, margin = 48): Camera {
  if (!bounds || width <= 0 || height <= 0) return { x: -width / 2, y: -height / 2, zoom: 1 }
  const zoom = clampZoom(
    Math.min(
      1,
      (width - margin * 2) / Math.max(bounds.width, 1),
      (height - margin * 2) / Math.max(bounds.height, 1)
    )
  )
  return {
    x: bounds.x + bounds.width / 2 - width / 2 / zoom,
    y: bounds.y + bounds.height / 2 - height / 2 / zoom,
    zoom
  }
}

/** The world rectangle the view shows. */
export function viewRect(camera: Camera, width: number, height: number): Rect {
  return { x: camera.x, y: camera.y, width: width / camera.zoom, height: height / camera.zoom }
}

/** A rectangle grown on all sides by a share of its size, to draw a bit beyond the view. */
export function grow(rect: Rect, share: number): Rect {
  const dx = rect.width * share
  const dy = rect.height * share
  return {
    x: rect.x - dx,
    y: rect.y - dy,
    width: rect.width + 2 * dx,
    height: rect.height + 2 * dy
  }
}
