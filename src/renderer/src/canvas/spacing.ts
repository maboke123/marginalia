import type { Rect } from '../../../shared/canvas'

/** A gap drawn as a measure line, in canvas units. */
export interface Gap {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface SpacingSnap {
  /** How far to move the box along the axis. */
  delta: number
  /** The gaps that are now equal: the moved box's own and the ones it matches. */
  gaps: Gap[]
}

type Axis = 'x' | 'y'

const start = (r: Rect, axis: Axis): number => (axis === 'x' ? r.x : r.y)
const size = (r: Rect, axis: Axis): number => (axis === 'x' ? r.width : r.height)
const end = (r: Rect, axis: Axis): number => start(r, axis) + size(r, axis)
const across: Record<Axis, Axis> = { x: 'y', y: 'x' }

/** A gap along `axis` from `a` to `b`, drawn halfway across where the two overlap. */
function gapBetween(a: number, b: number, axis: Axis, p: Rect, q: Rect): Gap {
  const other = across[axis]
  const lo = Math.max(start(p, other), start(q, other))
  const hi = Math.min(end(p, other), end(q, other))
  const mid = lo <= hi ? (lo + hi) / 2 : start(p, other) + size(p, other) / 2
  return axis === 'x' ? { x1: a, y1: mid, x2: b, y2: mid } : { x1: mid, y1: a, x2: mid, y2: b }
}

/**
 * Snaps a moved box along one axis so the space to its neighbour in the same row (or column)
 * equals a space already there between two other boxes, or so it sits in the middle between
 * its two neighbours. Null when nothing is within `threshold`.
 */
export function snapSpacing(
  box: Rect,
  others: Rect[],
  axis: Axis,
  threshold: number
): SpacingSnap | null {
  const other = across[axis]
  // The boxes beside it: overlapping it across the axis.
  const row = others
    .filter((r) => start(r, other) < end(box, other) && end(r, other) > start(box, other))
    .sort((a, b) => start(a, axis) - start(b, axis))
  const before = row.filter((r) => end(r, axis) <= start(box, axis) + threshold).pop()
  const after = row.find((r) => start(r, axis) >= end(box, axis) - threshold)

  // Spaces between neighbouring boxes of the row, not counting the moved box.
  const spaces: { size: number; gap: Gap }[] = []
  for (let i = 1; i < row.length; i++) {
    const [a, b] = [row[i - 1], row[i]]
    const space = start(b, axis) - end(a, axis)
    if (space > 0)
      spaces.push({ size: space, gap: gapBetween(end(a, axis), start(b, axis), axis, a, b) })
  }

  let best: SpacingSnap | null = null
  const consider = (pos: number, gaps: Gap[]): void => {
    const delta = pos - start(box, axis)
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { delta, gaps }
    }
  }
  const moved = (pos: number): Rect => (axis === 'x' ? { ...box, x: pos } : { ...box, y: pos })

  if (before && after) {
    const pos = (end(before, axis) + start(after, axis) - size(box, axis)) / 2
    const b = moved(pos)
    if (pos > end(before, axis)) {
      consider(pos, [
        gapBetween(end(before, axis), pos, axis, before, b),
        gapBetween(end(b, axis), start(after, axis), axis, b, after)
      ])
    }
  }
  for (const space of spaces) {
    if (before) {
      const pos = end(before, axis) + space.size
      consider(pos, [gapBetween(end(before, axis), pos, axis, before, moved(pos)), space.gap])
    }
    if (after) {
      const pos = start(after, axis) - space.size - size(box, axis)
      const b = moved(pos)
      consider(pos, [gapBetween(end(b, axis), start(after, axis), axis, b, after), space.gap])
    }
  }
  return best
}
