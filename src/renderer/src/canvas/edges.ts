import {
  edgeStyle,
  facingSides,
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

/** How an end meets its box: where along the side (0 to 1) and the box's shape. */
export interface EndAt {
  at?: number
  shape?: string
}

const CURVED = new Set(['ellipse', 'circle', 'diamond'])

/**
 * The point at `t` along a box's side (0 is its left or top end). On an ellipse or diamond it
 * lies on the outline and stays near the middle, where the outline still faces outward.
 */
export function sideAt(rect: Rect, side: Side, t = 0.5, shape?: string): Point {
  const curved = !!shape && CURVED.has(shape)
  const along = curved ? 0.5 + (t - 0.5) * 0.6 : t
  const u = Math.abs(along * 2 - 1)
  const depth = !curved ? 0 : shape === 'diamond' ? u : 1 - Math.sqrt(1 - u * u)
  if (side === 'top' || side === 'bottom') {
    const inset = (rect.height / 2) * depth
    return {
      x: rect.x + rect.width * along,
      y: side === 'top' ? rect.y + inset : rect.y + rect.height - inset
    }
  }
  const inset = (rect.width / 2) * depth
  return {
    x: side === 'left' ? rect.x + inset : rect.x + rect.width - inset,
    y: rect.y + rect.height * along
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
  toMarker: Marker,
  fromEnd: EndAt = {},
  toEnd: EndAt = {}
): EdgeGeometry {
  const start = sideAt(from, fromSide, fromEnd.at, fromEnd.shape)
  const end = sideAt(to, toSide, toEnd.at, toEnd.shape)
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

/** How far a right-angle line goes straight out of a box before it turns. */
const STUB = 24
const CORNER = 8
// What a bend and a crossing of another arrow cost, as length: a route may be this much longer
// to avoid one.
const BEND = 30
const CROSSING = 200
const THROUGH_BOX = 100_000
/** Room between arrows that would otherwise run on top of each other. */
const LANE = 10
/** Radius of the hop where one arrow jumps over another. */
const HOP = 5

type Segment = [Point, Point]

const same = (a: number, b: number): boolean => Math.abs(a - b) < 0.01
const horizontal = (a: Point, b: Point): boolean => same(a.y, b.y) && !same(a.x, b.x)
const vertical = (a: Point, b: Point): boolean => same(a.x, b.x) && !same(a.y, b.y)
const between = (v: number, a: number, b: number, margin = 0.5): boolean =>
  v > Math.min(a, b) + margin && v < Math.max(a, b) - margin

/** Whether a horizontal and a vertical piece cross inside both. */
function crossing(a: Point, b: Point, c: Point, d: Point): boolean {
  if (horizontal(a, b) && vertical(c, d)) return between(c.x, a.x, b.x) && between(a.y, c.y, d.y)
  if (vertical(a, b) && horizontal(c, d)) return between(a.x, c.x, d.x) && between(c.y, a.y, b.y)
  return false
}

/** Whether a horizontal or vertical segment runs through the inside of a box. */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const e = 0.5
  return (
    Math.max(a.x, b.x) > r.x + e &&
    Math.min(a.x, b.x) < r.x + r.width - e &&
    Math.max(a.y, b.y) > r.y + e &&
    Math.min(a.y, b.y) < r.y + r.height - e
  )
}

/** The points without repeats and without points in the middle of a straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue
    const before = out[out.length - 2]
    if (
      before &&
      last &&
      (before.x === last.x) === (last.x === p.x) &&
      (before.y === last.y) === (last.y === p.y)
    ) {
      out[out.length - 1] = p
      continue
    }
    out.push(p)
  }
  return out
}

/**
 * A line of horizontal and vertical pieces from `start` to `end`, leaving and entering along
 * the sides' normals, through as few boxes as it can, then crossing as few `others` (pieces
 * of arrows routed before), then as short and with as few bends as it can. Tries routes with
 * one to three bends, turning at the middle (first, so ties go there) or just past a box; five
 * when those all go through a box.
 */
export function elbowRoute(
  start: Point,
  startSide: Side,
  end: Point,
  endSide: Side,
  boxes: Rect[],
  others: Segment[] = []
): Point[] {
  const s = add(start, NORMALS[startSide], STUB)
  const e = add(end, NORMALS[endSide], STUB)
  const area = {
    x: Math.min(s.x, e.x) - 300,
    y: Math.min(s.y, e.y) - 300,
    width: Math.abs(s.x - e.x) + 600,
    height: Math.abs(s.y - e.y) + 600
  }
  const near = boxes.filter((r) =>
    crosses({ x: area.x, y: area.y }, { x: area.x + area.width, y: area.y + area.height }, r)
  )
  const xs = new Set([(s.x + e.x) / 2, s.x, e.x])
  const ys = new Set([(s.y + e.y) / 2, s.y, e.y])
  for (const r of near) {
    xs.add(r.x - STUB)
    xs.add(r.x + r.width + STUB)
    ys.add(r.y - STUB)
    ys.add(r.y + r.height + STUB)
  }
  const nearOthers = others.filter(([a, b]) =>
    crosses(a, b, { ...area, x: area.x - 1, y: area.y - 1 })
  )
  const scoreOf = (points: Point[]): number => {
    let score = (points.length - 2) * BEND
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]]
      score += Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      score += near.filter((r) => crosses(a, b, r)).length * THROUGH_BOX
      score += nearOthers.filter(([c, d]) => crossing(a, b, c, d)).length * CROSSING
    }
    return score
  }
  let best: { points: Point[]; score: number } | null = null
  const consider = (c: Point[]): void => {
    const points = simplify([start, ...c, end])
    const score = scoreOf(points)
    if (!best || score < best.score) best = { points, score }
  }
  // Halfway between the boxes first: of routes as good, it is the one that reads best.
  const [midX, midY] = [(s.x + e.x) / 2, (s.y + e.y) / 2]
  consider([s, { x: midX, y: s.y }, { x: midX, y: e.y }, e])
  consider([s, { x: s.x, y: midY }, { x: e.x, y: midY }, e])
  for (const x of xs) consider([s, { x, y: s.y }, { x, y: e.y }, e])
  for (const y of ys) consider([s, { x: s.x, y }, { x: e.x, y }, e])
  if (best!.score >= THROUGH_BOX) {
    for (const x of xs) {
      for (const y of ys) {
        consider([s, { x, y: s.y }, { x, y }, { x: e.x, y }, e])
        consider([s, { x: s.x, y }, { x, y }, { x, y: e.y }, e])
      }
    }
  }
  return best!.points
}

/** A straight piece of an arrow. */
interface Run {
  route: number
  /** The piece runs from point `index` to `index + 1`. */
  index: number
  horizontal: boolean
  /** Its y when horizontal, else its x. */
  at: number
  lo: number
  hi: number
  /**
   * Where it turns, along it, and which way the next piece goes from there (-1 or 1; 0 where
   * it meets a box).
   */
  ends: { along: number; dir: number }[]
  /** The first or last piece: it meets a box there, so it cannot move sideways. */
  fixed: boolean
}

/** Crossings when `p` takes the lane before `q` (above it, or left of it). */
function laneCost(p: Run, q: Run): number {
  const into = (run: Run, other: Run, dir: number): number =>
    run.ends.filter((end) => end.dir === dir && between(end.along, other.lo, other.hi)).length
  return into(p, q, 1) + into(q, p, -1)
}

function orderCost(order: Run[]): number {
  let cost = 0
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) cost += laneCost(order[i], order[j])
  }
  return cost
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  )
}

/** The order of lanes that crosses least: every order for a few arrows, else pairwise. */
function bestOrder(runs: Run[]): Run[] {
  if (runs.length <= 6) {
    let best = runs
    let cost = orderCost(runs)
    for (const order of permutations(runs)) {
      const c = orderCost(order)
      if (c < cost) [best, cost] = [order, c]
    }
    return best
  }
  return [...runs].sort((p, q) => laneCost(p, q) - laneCost(q, p))
}

/**
 * Arrows that would run on top of each other (the same line, overlapping) move apart into
 * lanes `LANE` wide, in the order that makes them cross least. Only the pieces between two
 * bends move, so every arrow still leaves and enters its boxes where it did; one that cannot
 * move keeps its place and the others take lanes beside it.
 */
export function separateRuns(routes: Point[][]): Point[][] {
  const runs: Run[] = []
  routes.forEach((points, route) => {
    for (let k = 0; k + 1 < points.length; k++) {
      const [before, a, b, after] = [points[k - 1], points[k], points[k + 1], points[k + 2]]
      const flat = horizontal(a, b)
      if (!flat && !vertical(a, b)) continue
      const at = flat ? a.y : a.x
      const along = (p: Point): number => (flat ? p.x : p.y)
      const across = (p?: Point): number => (p ? Math.sign((flat ? p.y : p.x) - at) : 0)
      runs.push({
        route,
        index: k,
        horizontal: flat,
        at,
        lo: Math.min(along(a), along(b)),
        hi: Math.max(along(a), along(b)),
        ends: [
          { along: along(a), dir: across(before) },
          { along: along(b), dir: across(after) }
        ],
        fixed: k === 0 || k + 2 === points.length
      })
    }
  })
  const lines = new Map<string, Run[]>()
  for (const run of runs) {
    const key = `${run.horizontal ? 'h' : 'v'}${Math.round(run.at * 10)}`
    lines.set(key, [...(lines.get(key) ?? []), run])
  }
  const out = routes.map((points) => points.map((p) => ({ ...p })))
  for (const line of lines.values()) {
    line.sort((p, q) => p.lo - q.lo)
    // Pieces on one line that overlap each other, one after another.
    const clusters: Run[][] = []
    let reach = -Infinity
    for (const run of line) {
      if (run.lo < reach - 1) clusters[clusters.length - 1].push(run)
      else clusters.push([run])
      reach = Math.max(reach, run.hi)
    }
    for (const cluster of clusters) {
      if (cluster.length < 2 || cluster.every((run) => run.fixed)) continue
      const order = bestOrder(cluster)
      const pinned = order.findIndex((run) => run.fixed)
      const centre = pinned >= 0 ? pinned : (cluster.length - 1) / 2
      order.forEach((run, k) => {
        if (run.fixed) return
        const at = run.at + (k - centre) * LANE
        for (const p of [out[run.route][run.index], out[run.route][run.index + 1]]) {
          if (run.horizontal) p.y = at
          else p.x = at
        }
      })
    }
  }
  return out
}

/**
 * Where arrows cross: by route, the pieces (by index) that hop over another arrow there and
 * how far along. The horizontal piece hops, the vertical one goes straight on.
 */
export function hopsOf(routes: Point[][]): Map<number, Map<number, number[]>> {
  const hops = new Map<number, Map<number, number[]>>()
  const margin = CORNER + HOP + 1
  routes.forEach((points, r) => {
    for (let k = 0; k + 1 < points.length; k++) {
      const [a, b] = [points[k], points[k + 1]]
      if (!horizontal(a, b)) continue
      routes.forEach((other, o) => {
        if (o === r) return
        for (let j = 0; j + 1 < other.length; j++) {
          const [c, d] = [other[j], other[j + 1]]
          if (!vertical(c, d) || !between(c.x, a.x, b.x, margin) || !between(a.y, c.y, d.y)) {
            continue
          }
          const byPiece = hops.get(r) ?? new Map<number, number[]>()
          byPiece.set(k, [...(byPiece.get(k) ?? []), c.x])
          hops.set(r, byPiece)
        }
      })
    }
  })
  return hops
}

/** The point halfway along a line of straight pieces. */
function halfway(points: Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let left = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) {
      const t = lengths[i] ? left / lengths[i] : 0
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t
      }
    }
    left -= lengths[i]
  }
  return points[points.length - 1]
}

/** Straight pieces with slightly rounded corners and hops (by piece), as an SVG path. */
function roundedPath(points: Point[], hops = new Map<number, number[]>()): string {
  // A hop is a half circle over the other arrow, on the upper side.
  const hopsOn = (k: number): string => {
    const [a, b] = [points[k], points[k + 1]]
    const dir = Math.sign(b.x - a.x)
    return [...(hops.get(k) ?? [])]
      .sort((x, y) => (x - y) * dir)
      .map(
        (x) =>
          ` L${f(x - dir * HOP)},${f(a.y)} A${HOP},${HOP} 0 0 ${dir > 0 ? 1 : 0} ${f(x + dir * HOP)},${f(a.y)}`
      )
      .join('')
  }
  let d = `M${f(points[0].x)},${f(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const [a, p, b] = [points[i - 1], points[i], points[i + 1]]
    const r = Math.min(
      CORNER,
      Math.hypot(p.x - a.x, p.y - a.y) / 2,
      Math.hypot(b.x - p.x, b.y - p.y) / 2
    )
    const inDir = { x: Math.sign(p.x - a.x), y: Math.sign(p.y - a.y) }
    const outDir = { x: Math.sign(b.x - p.x), y: Math.sign(b.y - p.y) }
    const p1 = add(p, inDir, -r)
    const p2 = add(p, outDir, r)
    d += `${hopsOn(i - 1)} L${f(p1.x)},${f(p1.y)} Q${f(p.x)},${f(p.y)} ${f(p2.x)},${f(p2.y)}`
  }
  const last = points[points.length - 1]
  return `${d}${hopsOn(points.length - 2)} L${f(last.x)},${f(last.y)}`
}

/** Like `edgeGeometry`, along a route of right angles (from `elbowRoute`). */
function elbowGeometry(
  points: Point[],
  fromSide: Side,
  toSide: Side,
  fromMarker: Marker,
  toMarker: Marker,
  hops?: Map<number, number[]>
): EdgeGeometry {
  const start = points[0]
  const end = points[points.length - 1]
  const outA = NORMALS[fromSide]
  const outB = NORMALS[toSide]
  // The line starts where a marker ends, like the curve.
  const line = [
    add(start, outA, MARKER_LENGTH[fromMarker]),
    ...points.slice(1, -1),
    add(end, outB, MARKER_LENGTH[toMarker])
  ]
  const markers = [
    markerShape(fromMarker, start, { x: -outA.x, y: -outA.y }),
    markerShape(toMarker, end, { x: -outB.x, y: -outB.y })
  ].filter((m): m is MarkerShape => !!m)
  const beside = (p: Point, out: Point): Point => add(add(p, out, 22), { x: -out.y, y: out.x }, 14)
  return {
    path: roundedPath(line, hops),
    markers,
    middle: halfway(points),
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

const shapeOf = (node: CanvasNode): string | undefined =>
  node.type === 'text' ? node.shape : undefined

/** Where along their sides an edge's two ends sit (0 to 1), by edge id. */
export type Ports = Map<string, { from: number; to: number }>

/**
 * Edges that meet the same side of a box spread along it, in the order of where their other
 * box lies, so arrows and their markers do not hide behind each other.
 */
export function edgePorts(edges: CanvasEdge[], byId: Map<string, CanvasNode>): Ports {
  const sides = new Map<string, { edge: string; end: 'from' | 'to'; along: number }[]>()
  for (const edge of edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue
    const [fromSide, toSide] = facingSides(from, to)
    const ends = [
      ['from', from, edge.fromSide ?? fromSide, to],
      ['to', to, edge.toSide ?? toSide, from]
    ] as const
    for (const [end, node, side, other] of ends) {
      const along =
        side === 'top' || side === 'bottom' ? other.x + other.width / 2 : other.y + other.height / 2
      const key = `${node.id}:${side}`
      sides.set(key, [...(sides.get(key) ?? []), { edge: edge.id, end, along }])
    }
  }
  const ports: Ports = new Map()
  for (const list of sides.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.along - b.along)
    list.forEach(({ edge, end }, i) => {
      const port = ports.get(edge) ?? { from: 0.5, to: 0.5 }
      ports.set(edge, { ...port, [end]: (i + 1) / (list.length + 1) })
    })
  }
  return ports
}

/**
 * Every edge's line between its two boxes (none when a box is missing). Right-angle edges are
 * routed together: each avoids crossing the ones before it, lines on top of each other move
 * apart, and where two still cross one hops over the other.
 */
export function edgeGeometries(
  edges: CanvasEdge[],
  byId: Map<string, CanvasNode>
): Map<string, EdgeGeometry> {
  const ports = edgePorts(edges, byId)
  const boxes = [...byId.values()].filter((n) => n.type !== 'group')
  const out = new Map<string, EdgeGeometry>()
  const elbows: { id: string; sides: [Side, Side]; markers: [Marker, Marker] }[] = []
  const routes: Point[][] = []
  const taken: Segment[] = []
  for (const edge of edges) {
    const from = byId.get(edge.fromNode)
    const to = byId.get(edge.toNode)
    if (!from || !to) continue
    const [facingFrom, facingTo] = facingSides(from, to)
    const fromSide = edge.fromSide ?? facingFrom
    const toSide = edge.toSide ?? facingTo
    const style = edgeStyle(edge)
    const port = ports.get(edge.id)
    const fromEnd = { at: port?.from, shape: shapeOf(from) }
    const toEnd = { at: port?.to, shape: shapeOf(to) }
    if (edge.route !== 'elbow') {
      out.set(
        edge.id,
        edgeGeometry(from, fromSide, to, toSide, style.fromMarker, style.toMarker, fromEnd, toEnd)
      )
      continue
    }
    const start = sideAt(from, fromSide, fromEnd.at, fromEnd.shape)
    const end = sideAt(to, toSide, toEnd.at, toEnd.shape)
    const points = elbowRoute(start, fromSide, end, toSide, boxes, taken)
    points.slice(1).forEach((p, i) => taken.push([points[i], p]))
    routes.push(points)
    elbows.push({
      id: edge.id,
      sides: [fromSide, toSide],
      markers: [style.fromMarker, style.toMarker]
    })
  }
  const apart = separateRuns(routes)
  const hops = hopsOf(apart)
  elbows.forEach((e, i) => {
    out.set(e.id, elbowGeometry(apart[i], ...e.sides, ...e.markers, hops.get(i)))
  })
  return out
}

/** One edge's line between its two boxes, or null when a box is missing. */
export function geometryOf(edge: CanvasEdge, byId: Map<string, CanvasNode>): EdgeGeometry | null {
  return edgeGeometries([edge], byId).get(edge.id) ?? null
}
