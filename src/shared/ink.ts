import { getStroke } from 'perfect-freehand'
import type { Stroke } from './annotations'

const average = (a: number, b: number): number => (a + b) / 2

// From the perfect-freehand README: turns the outline polygon into a smooth closed path.
function pathFromOutline(points: number[][]): string {
  if (points.length < 4) return ''
  let a = points[0]
  let b = points[1]
  const c = points[2]
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`
  for (let i = 2; i < points.length - 1; i++) {
    a = points[i]
    b = points[i + 1]
    d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `
  }
  return d + 'Z'
}

/**
 * The filled outline of a stroke as an SVG path in page points. Shared by the screen and the
 * PDF export, so exported ink has exactly the shape it had on screen.
 */
export function strokeOutline(stroke: Stroke, live = false): string {
  const pen = stroke.tool === 'pen'
  return pathFromOutline(
    getStroke(stroke.points, {
      size: stroke.width,
      thinning: pen ? 0.5 : 0,
      smoothing: 0.5,
      streamline: pen ? 0.5 : 0.3,
      // A mouse always reports pressure 0.5; let perfect-freehand fake it from speed instead.
      simulatePressure: stroke.points.every((p) => p[2] === 0.5),
      last: !live
    })
  )
}
