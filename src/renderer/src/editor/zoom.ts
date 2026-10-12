const KEY = 'noteZoom'
const STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5]
const MIN = STEPS[0]
const MAX = STEPS[STEPS.length - 1]

/** The next zoom level above or below `zoom`, so zooming from 100% lands on round numbers. */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return STEPS.find((s) => s > zoom + 0.001) ?? MAX
  return [...STEPS].reverse().find((s) => s < zoom - 0.001) ?? MIN
}

/** Zoom for a Ctrl+wheel event. A touchpad pinch sends many small deltas, so this is
 * continuous (same rate as the PDF viewer) instead of one step per event. */
export function zoomByWheel(zoom: number, deltaY: number): number {
  const next = zoom * Math.exp(-deltaY / 500)
  return Math.round(Math.min(MAX, Math.max(MIN, next)) * 1000) / 1000
}

// Like the folds and expanded folders, zoom is a per-machine view setting.
export function readZoom(): number {
  const value = Number(localStorage.getItem(KEY))
  return value >= MIN && value <= MAX ? value : 1
}

export function saveZoom(zoom: number): void {
  if (zoom === 1) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, String(zoom))
}
