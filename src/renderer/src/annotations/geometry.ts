import type { Highlight, Stroke } from '../../../shared/annotations'

export type Point = [number, number]
export type Rect = [number, number, number, number]

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** True when `p` lies on the stroke, with `tolerance` points of slack around its width. */
export function hitsStroke(stroke: Stroke, p: Point, tolerance: number): boolean {
  const reach = stroke.width / 2 + tolerance
  const pts = stroke.points
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach
  for (let i = 1; i < pts.length; i++) {
    const a: Point = [pts[i - 1][0], pts[i - 1][1]]
    const b: Point = [pts[i][0], pts[i][1]]
    if (distanceToSegment(p, a, b) <= reach) return true
  }
  return false
}

export function hitsRects(rects: Rect[], p: Point): boolean {
  return rects.some(([x, y, w, h]) => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h)
}

/**
 * Samples the eraser's path from `a` to `b` every few points, so a fast mouse movement
 * still erases everything it crossed.
 */
export function sweep(a: Point, b: Point, step: number): Point[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  return Array.from({ length: steps + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / steps,
    a[1] + ((b[1] - a[1]) * i) / steps
  ])
}

export function erasedStrokes(strokes: Stroke[], path: Point[], radius: number): string[] {
  return strokes.filter((s) => path.some((p) => hitsStroke(s, p, radius))).map((s) => s.id)
}

export function erasedHighlights(highlights: Highlight[], path: Point[]): string[] {
  return highlights.filter((h) => path.some((p) => hitsRects(h.rects, p))).map((h) => h.id)
}

export function strokeBounds(stroke: Stroke): Rect {
  const xs = stroke.points.map((p) => p[0])
  const ys = stroke.points.map((p) => p[1])
  const pad = stroke.width / 2
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return [x, y, Math.max(...xs) + pad - x, Math.max(...ys) + pad - y]
}

export function translateStroke(stroke: Stroke, dx: number, dy: number): Stroke {
  return { ...stroke, points: stroke.points.map(([x, y, p]) => [round(x + dx), round(y + dy), p]) }
}

export function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Turns the rectangles of a text selection (one per text run, often overlapping or with
 * small gaps) into one rectangle per line.
 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const lines: Rect[] = []
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l[1] + l[3], r[1] + r[3]) - Math.max(l[1], r[1])
      return overlap > 0.5 * Math.min(l[3], r[3])
    })
    if (!line) {
      lines.push([...r])
      continue
    }
    const x = Math.min(line[0], r[0])
    const y = Math.min(line[1], r[1])
    line[2] = Math.max(line[0] + line[2], r[0] + r[2]) - x
    line[3] = Math.max(line[1] + line[3], r[1] + r[3]) - y
    line[0] = x
    line[1] = y
  }
  return lines.map((l) => l.map(round) as Rect)
}
