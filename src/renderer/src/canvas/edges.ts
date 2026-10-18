import {
  edgeStyle,
  facingSides,
  sidePoint,
  type CanvasEdge,
  type CanvasNode,
  type Marker,
  type Rect,
  type Side
} from '../../../shared/canvas'

interface Point {
  x: number
  y: number
}

const NORMALS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 }
}

const MARKER_LENGTH: Record<Marker, number> = {
  none: 0,
  arrow: 0,
  triangle: 16,
  diamond: 20,
  'diamond-filled': 20
}

export interface MarkerShape {
  d: string
  /** Open arrows are lines; triangles and hollow diamonds are filled with the background. */
  fill: 'none' | 'background' | 'line'
}

export interface EdgeGeometry {
  path: string
  markers: MarkerShape[]
  /** Middle of the curve, for the label. */
  middle: Point
  /** Near each end, beside the line, for multiplicities. */
  fromLabelAt: Point
  toLabelAt: Point
}

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const f = (n: number): string => n.toFixed(1)

function bezierAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
  }
}

/** A marker with its tip on `tip`, pointing along `dir` (a unit vector into the node). */
function markerShape(marker: Marker, tip: Point, dir: Point): MarkerShape | null {
  const back = { x: -dir.x, y: -dir.y }
  const across = { x: -dir.y, y: dir.x }
  const at = (along: number, side: number): string => {
    const p = add(add(tip, back, along), across, side)
    return `${f(p.x)},${f(p.y)}`
  }
  const t = `${f(tip.x)},${f(tip.y)}`
  switch (marker) {
    case 'arrow':
      return { d: `M${at(13, 7)} L${t} L${at(13, -7)}`, fill: 'none' }
    case 'triangle':
      return { d: `M${t} L${at(16, 9)} L${at(16, -9)} Z`, fill: 'background' }
    case 'diamond':
    case 'diamond-filled':
      return {
        d: `M${t} L${at(10, 6)} L${at(20, 0)} L${at(10, -6)} Z`,
        fill: marker === 'diamond' ? 'background' : 'line'
      }
    default:
      return null
  }
}

/**
 * The curve of an edge from one box side to another, like Obsidian draws it: it leaves and
 * enters each box at right angles. Markers sit on the box edge and the line stops at them.
 */
export function edgeGeometry(
  from: Rect,
  fromSide: Side,
  to: Rect,
  toSide: Side,
  fromMarker: Marker,
  toMarker: Marker
): EdgeGeometry {
  const start = sidePoint(from, fromSide)
  const end = sidePoint(to, toSide)
  const outA = NORMALS[fromSide]
  const outB = NORMALS[toSide]
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const reach = Math.min(200, Math.max(40, distance * 0.4))
  // The line starts where a marker ends, so it does not show through a hollow one.
  const lineStart = add(start, outA, MARKER_LENGTH[fromMarker])
  const lineEnd = add(end, outB, MARKER_LENGTH[toMarker])
  const c1 = add(start, outA, reach)
  const c2 = add(end, outB, reach)
  const path = `M${f(lineStart.x)},${f(lineStart.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(lineEnd.x)},${f(lineEnd.y)}`
  const markers = [
    markerShape(fromMarker, start, { x: -outA.x, y: -outA.y }),
    markerShape(toMarker, end, { x: -outB.x, y: -outB.y })
  ].filter((m): m is MarkerShape => !!m)
  const beside = (p: Point, out: Point): Point => add(add(p, out, 22), { x: -out.y, y: out.x }, 14)
  return {
    path,
    markers,
    middle: bezierAt(start, c1, c2, end, 0.5),
    fromLabelAt: beside(start, outA),
    toLabelAt: beside(end, outB)
  }
}

/** While an arrow is dragged out: the side a free end comes in from, facing its start. */
export function freeEndSide(start: Point, end: Point): Side {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right'
  return dy >= 0 ? 'top' : 'bottom'
}

/** An edge's curve between its two boxes, or null when a box is missing. */
export function geometryOf(edge: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null {
  const from = byId.get(edge.fromNode)
  const to = byId.get(edge.toNode)
  if (!from || !to) return null
  const [fromSide, toSide] = facingSides(from, to)
  const style = edgeStyle(edge)
  return edgeGeometry(
    from,
    edge.fromSide ?? fromSide,
    to,
    edge.toSide ?? toSide,
    style.fromMarker,
    style.toMarker
  )
}
