import {
  boundsOf,
  contains,
  facingSides,
  inGroup,
  newCanvasId,
  overlaps,
  sidePoint,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type GroupNode,
  type InkNode,
  type InkStroke,
  type Rect,
  type Side
} from '../../../shared/canvas'
import { snapAxis } from '../annotations/snap'
import { grow } from './camera'

// Pure edits of a canvas. Each returns a new CanvasData and keeps unchanged nodes and edges as
// the same objects, so React only redraws what changed.

export interface Selection {
  nodes: string[]
  edges: string[]
}

export const NOTHING: Selection = { nodes: [], edges: [] }

export const isEmpty = (s: Selection): boolean => !s.nodes.length && !s.edges.length

export const nodeById = (data: CanvasData, id: string): CanvasNode | undefined =>
  data.nodes.find((n) => n.id === id)

/** Groups first: they are drawn behind everything else, bigger ones further back. */
export function drawOrder(nodes: CanvasNode[]): CanvasNode[] {
  const groups = nodes
    .filter((n) => n.type === 'group')
    .sort((a, b) => b.width * b.height - a.width * a.height)
  return [...groups, ...nodes.filter((n) => n.type !== 'group')]
}

export function addNodes(data: CanvasData, nodes: CanvasNode[]): CanvasData {
  return { ...data, nodes: [...data.nodes, ...nodes] }
}

/** Changes fields of one node: its rectangle, text, label, colour. */
export function updateNode(
  data: CanvasData,
  id: string,
  change: Rect | Partial<CanvasNode>
): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => (n.id === id ? ({ ...n, ...change } as CanvasNode) : n))
  }
}

export function updateEdge(
  data: CanvasData,
  id: string,
  change: (edge: CanvasEdge) => CanvasEdge
): CanvasData {
  return { ...data, edges: data.edges.map((e) => (e.id === id ? change(e) : e)) }
}

/** Removes nodes and edges; edges of removed nodes go too. */
export function removeItems(data: CanvasData, selection: Selection): CanvasData {
  const nodes = new Set(selection.nodes)
  const edges = new Set(selection.edges)
  return {
    ...data,
    nodes: data.nodes.filter((n) => !nodes.has(n.id)),
    edges: data.edges.filter(
      (e) => !edges.has(e.id) && !nodes.has(e.fromNode) && !nodes.has(e.toNode)
    )
  }
}

/** The nodes a move takes along: the chosen ones plus everything inside chosen groups. */
export function movingSet(data: CanvasData, ids: string[]): Set<string> {
  const moving = new Set(ids)
  for (const id of ids) {
    const node = nodeById(data, id)
    if (node?.type === 'group') for (const inner of inGroup(node, data.nodes)) moving.add(inner.id)
  }
  return moving
}

/** Moves nodes from where they were in `from` (the canvas at drag start) by (dx, dy). */
export function moveNodes(
  data: CanvasData,
  from: CanvasData,
  ids: Set<string>,
  dx: number,
  dy: number
): CanvasData {
  const start = new Map(from.nodes.map((n) => [n.id, n]))
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      const was = start.get(n.id)
      if (!ids.has(n.id) || !was) return n
      return { ...n, x: Math.round(was.x + dx), y: Math.round(was.y + dy) }
    })
  }
}

export type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export const MIN_SIZE = 24

/** A node's rectangle after dragging one of its handles by (dx, dy). */
export function resized(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  keepRatio = false
): Rect {
  let { x, y, width, height } = rect
  if (handle.includes('e')) width = Math.max(MIN_SIZE, rect.width + dx)
  if (handle.includes('s')) height = Math.max(MIN_SIZE, rect.height + dy)
  if (handle.includes('w')) {
    width = Math.max(MIN_SIZE, rect.width - dx)
    x = rect.x + rect.width - width
  }
  if (handle.includes('n')) {
    height = Math.max(MIN_SIZE, rect.height - dy)
    y = rect.y + rect.height - height
  }
  if (keepRatio && rect.width > 0 && rect.height > 0) {
    const ratio = rect.width / rect.height
    if (handle === 'n' || handle === 's') width = height * ratio
    else height = width / ratio
    if (handle.includes('w')) x = rect.x + rect.width - width
    if (handle.includes('n')) y = rect.y + rect.height - height
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

/**
 * A resized rectangle whose dragged sides snap to the lines `xs` / `ys` within `threshold`,
 * with where to draw the guides.
 */
export function snapResized(
  rect: Rect,
  handle: Handle,
  xs: number[],
  ys: number[],
  threshold: number
): { rect: Rect; gx: number | null; gy: number | null } {
  let { x, y, width, height } = rect
  let gx: number | null = null
  let gy: number | null = null
  const nearest = (v: number, lines: number[]): number | null => {
    const hit = snapAxis(v, [{ offset: 0, targets: lines }], threshold)
    return hit.guide
  }
  if (handle.includes('e')) {
    const t = nearest(x + width, xs)
    if (t !== null && t - x >= MIN_SIZE) [width, gx] = [t - x, t]
  } else if (handle.includes('w')) {
    const t = nearest(x, xs)
    if (t !== null && x + width - t >= MIN_SIZE) [width, x, gx] = [x + width - t, t, t]
  }
  if (handle.includes('s')) {
    const t = nearest(y + height, ys)
    if (t !== null && t - y >= MIN_SIZE) [height, gy] = [t - y, t]
  } else if (handle.includes('n')) {
    const t = nearest(y, ys)
    if (t !== null && y + height - t >= MIN_SIZE) [height, y, gy] = [y + height - t, t, t]
  }
  return { rect: { x, y, width, height }, gx, gy }
}

/** Nodes whose box lies inside a dragged selection rectangle (groups only when fully inside). */
export function nodesIn(data: CanvasData, rect: Rect): string[] {
  return data.nodes
    .filter((n) => (n.type === 'group' ? contains(rect, n) : overlaps(rect, n)))
    .map((n) => n.id)
}

/**
 * Copies of nodes and of the edges between them, with new ids, moved by (dx, dy). Returns the
 * copies, so they can be pasted in another canvas too.
 */
export function copyItems(
  data: CanvasData,
  ids: string[],
  dx: number,
  dy: number
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const chosen = movingSet(data, ids)
  const fresh = new Map([...chosen].map((id) => [id, newCanvasId()]))
  const nodes = data.nodes
    .filter((n) => chosen.has(n.id))
    .map((n) => ({ ...n, id: fresh.get(n.id)!, x: n.x + dx, y: n.y + dy }) as CanvasNode)
  const edges = data.edges
    .filter((e) => chosen.has(e.fromNode) && chosen.has(e.toNode))
    .map((e) => ({
      ...e,
      id: newCanvasId(),
      fromNode: fresh.get(e.fromNode)!,
      toNode: fresh.get(e.toNode)!
    }))
  return { nodes, edges }
}

/**
 * Copies of the chosen items for Duplicate: a little down and right, but a group goes to the
 * first free spot on its right. Overlapping, the copy's rectangle took in the boxes under it,
 * and moving the copy then took them along.
 */
export function duplicateItems(
  data: CanvasData,
  ids: string[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const chosen = data.nodes.filter((n) => movingSet(data, ids).has(n.id))
  const box = boundsOf(chosen)
  if (!box || !chosen.some((n) => n.type === 'group')) return copyItems(data, ids, 30, 30)
  const overlaps = (dx: number): boolean =>
    data.nodes.some(
      (n) =>
        n.x < box.x + dx + box.width &&
        n.x + n.width > box.x + dx &&
        n.y < box.y + box.height &&
        n.y + n.height > box.y
    )
  let dx = box.width + 60
  while (overlaps(dx)) dx += 60
  return copyItems(data, ids, dx, 0)
}

/** One step of Larger / Smaller text. */
export const TEXT_STEP = 1.2

/**
 * Text boxes among `ids` with their text a step larger (1) or smaller (-1). The box grows or
 * shrinks with it, so the text wraps as before: making a box bigger by hand stays the way to
 * give the text more room.
 */
export function scaleText(data: CanvasData, ids: string[], step: 1 | -1): CanvasData {
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      if (n.type !== 'text' || !ids.includes(n.id)) return n
      const was = n.fontScale ?? 1
      const next = Math.round(Math.min(6, Math.max(0.5, was * TEXT_STEP ** step)) * 100) / 100
      const ratio = next / was
      return {
        ...n,
        width: Math.round(n.width * ratio),
        height: Math.round(n.height * ratio),
        fontScale: next
      }
    })
  }
}

/** Puts copied items in, placed so their top left lands at (x, y). */
export function pasteItems(
  data: CanvasData,
  items: { nodes: CanvasNode[]; edges: CanvasEdge[] },
  x: number,
  y: number
): { data: CanvasData; selection: Selection } {
  const box = boundsOf(items.nodes)
  if (!box) return { data, selection: NOTHING }
  const fresh = new Map(items.nodes.map((n) => [n.id, newCanvasId()]))
  const nodes = items.nodes.map(
    (n) => ({ ...n, id: fresh.get(n.id)!, x: n.x - box.x + x, y: n.y - box.y + y }) as CanvasNode
  )
  const edges = items.edges
    .filter((e) => fresh.has(e.fromNode) && fresh.has(e.toNode))
    .map((e) => ({
      ...e,
      id: newCanvasId(),
      fromNode: fresh.get(e.fromNode)!,
      toNode: fresh.get(e.toNode)!
    }))
  return {
    data: { ...data, nodes: [...data.nodes, ...nodes], edges: [...data.edges, ...edges] },
    selection: { nodes: nodes.map((n) => n.id), edges: [] }
  }
}

const GROUP_PADDING = 32
const GROUP_LABEL_ROOM = 28

/** A labelled group around the chosen nodes. */
export function groupAround(data: CanvasData, ids: string[], label = ''): GroupNode | null {
  const box = boundsOf(data.nodes.filter((n) => ids.includes(n.id)))
  if (!box) return null
  return {
    id: newCanvasId(),
    type: 'group',
    label,
    x: box.x - GROUP_PADDING,
    y: box.y - GROUP_PADDING - GROUP_LABEL_ROOM,
    width: box.width + GROUP_PADDING * 2,
    height: box.height + GROUP_PADDING * 2 + GROUP_LABEL_ROOM
  }
}

/** An edge from one node to another, on the sides that face each other unless given. */
export function connect(
  data: CanvasData,
  from: string,
  to: string,
  sides: { fromSide?: Side; toSide?: Side } = {}
): CanvasEdge | null {
  const a = nodeById(data, from)
  const b = nodeById(data, to)
  if (!a || !b || a.id === b.id) return null
  const [fromSide, toSide] = facingSides(a, b)
  return {
    id: newCanvasId(),
    fromNode: from,
    fromSide: sides.fromSide ?? fromSide,
    toNode: to,
    toSide: sides.toSide ?? toSide
  }
}

/** The side of a node nearest to a point, for where a dragged arrow lands. */
export function nearestSide(rect: Rect, x: number, y: number): Side {
  const distances: [Side, number][] = [
    ['top', Math.abs(y - rect.y)],
    ['bottom', Math.abs(y - (rect.y + rect.height))],
    ['left', Math.abs(x - rect.x)],
    ['right', Math.abs(x - (rect.x + rect.width))]
  ]
  return distances.sort((a, b) => a[1] - b[1])[0][0]
}

/** The topmost node under a world point, groups last (their inside is mostly empty). */
export function nodeAt(
  data: CanvasData,
  x: number,
  y: number,
  skip?: Set<string>
): CanvasNode | null {
  const order = drawOrder(data.nodes).reverse()
  return (
    order.find(
      (n) => !skip?.has(n.id) && x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
    ) ?? null
  )
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']

/**
 * The box an arrow dragged to (x, y) connects to, and on which side: the box under the point
 * (its nearest edge), else the box with a side's middle within `reach` (that side). Groups and
 * `skip` never count.
 */
export function connectTarget(
  data: CanvasData,
  x: number,
  y: number,
  reach: number,
  skip?: string
): { id: string; side: Side } | null {
  const boxes = data.nodes.filter((n) => n.type !== 'group' && n.id !== skip)
  const under = drawOrder(boxes)
    .reverse()
    .find((n) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)
  if (under) return { id: under.id, side: nearestSide(under, x, y) }
  let best: { id: string; side: Side } | null = null
  let distance = reach
  for (const n of boxes) {
    for (const side of SIDES) {
      const p = sidePoint(n, side)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d <= distance) {
        distance = d
        best = { id: n.id, side }
      }
    }
  }
  return best
}

/** Moves the chosen nodes to the end of the list, so they are drawn on top. */
export function bringToFront(data: CanvasData, ids: string[]): CanvasData {
  const chosen = new Set(ids)
  const front = data.nodes.filter((n) => chosen.has(n.id))
  if (!front.length) return data
  const last = data.nodes.slice(-front.length)
  if (last.every((n, i) => n === front[i])) return data
  return { ...data, nodes: [...data.nodes.filter((n) => !chosen.has(n.id)), ...front] }
}

/** Arrow keys: moves the chosen nodes (and what is in chosen groups) by a few points. */
export function nudge(data: CanvasData, ids: string[], dx: number, dy: number): CanvasData {
  return moveNodes(data, data, movingSet(data, ids), dx, dy)
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/**
 * A drawing with one more stroke (points in world units). A stroke near the drawing `base`
 * goes into it and the drawing grows to fit; otherwise it starts a new drawing.
 */
export function withStroke(base: InkNode | null, stroke: InkStroke): InkNode {
  const xs = stroke.points.map((p) => p[0])
  const ys = stroke.points.map((p) => p[1])
  const pad = stroke.width * 2
  const box = {
    x: Math.min(...xs) - pad,
    y: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2
  }
  const into = base && overlaps(grow(base, 0.5), box) ? base : null
  const all = boundsOf(into ? [into, box] : [box])!
  const left = Math.floor(all.x)
  const top = Math.floor(all.y)
  const moved = (
    points: [number, number, number][],
    dx: number,
    dy: number
  ): [number, number, number][] => points.map((p) => [round1(p[0] - dx), round1(p[1] - dy), p[2]])
  return {
    id: into?.id ?? newCanvasId(),
    type: 'ink',
    x: left,
    y: top,
    width: Math.ceil(all.x + all.width - left),
    height: Math.ceil(all.y + all.height - top),
    strokes: [
      ...(into?.strokes.map((s) => ({
        ...s,
        points: moved(s.points, left - into.x, top - into.y)
      })) ?? []),
      { ...stroke, points: moved(stroke.points, left, top) }
    ]
  }
}
