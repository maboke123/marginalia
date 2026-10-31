import { compactJson } from './compactJson'

// JSON Canvas 1.0 (jsoncanvas.org), the format Obsidian uses for .canvas files, plus fields of
// our own (shape, relation, fromLabel, toLabel, the ink node) that Obsidian ignores. Fields we
// do not know are kept as they are, so a canvas made in Obsidian loses nothing here.

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type End = 'none' | 'arrow'

export const SHAPES = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
  'circle',
  'note',
  'class',
  'actor',
  'initial',
  'final'
] as const
export type Shape = (typeof SHAPES)[number]

export const RELATIONS = [
  'association',
  'directed',
  'inheritance',
  'realization',
  'dependency',
  'aggregation',
  'composition'
] as const
export type Relation = (typeof RELATIONS)[number]

interface BaseNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** A preset "1" to "6" or a hex colour. */
  color?: string
  /** Our own: text size relative to normal, for a shape drawn bigger or added zoomed out. */
  fontScale?: number
  [extra: string]: unknown
}

export interface TextNode extends BaseNode {
  type: 'text'
  text: string
  shape?: Shape
}

export interface FileNode extends BaseNode {
  type: 'file'
  /** A vault path. */
  file: string
  subpath?: string
}

export interface LinkNode extends BaseNode {
  type: 'link'
  url: string
}

export interface GroupNode extends BaseNode {
  type: 'group'
  label?: string
}

export interface InkStroke {
  color: string
  width: number
  /** [x, y, pressure], relative to the node's top left. */
  points: [number, number, number][]
}

export interface InkNode extends BaseNode {
  type: 'ink'
  strokes: InkStroke[]
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | InkNode

export interface CanvasEdge {
  id: string
  fromNode: string
  fromSide?: Side
  fromEnd?: End
  toNode: string
  toSide?: Side
  toEnd?: End
  color?: string
  label?: string
  relation?: Relation
  fromLabel?: string
  toLabel?: string
  /** Our own: drawn with right angles around other boxes instead of as a curve. */
  route?: 'elbow'
  /**
   * Our own: where I dragged the middle piece of a right-angle arrow, its x when the arrow
   * leaves its box sideways, else its y. Without it the route is found by itself.
   */
  bend?: number
  [extra: string]: unknown
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  [extra: string]: unknown
}

export const EMPTY_CANVAS: CanvasData = { nodes: [], edges: [] }

export class CanvasError extends Error {}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const NODE_TYPES = ['text', 'file', 'link', 'group', 'ink']
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isString = (v: unknown): v is string => typeof v === 'string'

function checkNode(value: unknown, i: number): CanvasNode {
  const node = value as Record<string, unknown>
  const where = `node ${i + 1}`
  if (!node || typeof node !== 'object') throw new CanvasError(`${where} is not an object`)
  if (!isString(node.id) || !node.id) throw new CanvasError(`${where} has no id`)
  if (!NODE_TYPES.includes(node.type as string)) {
    throw new CanvasError(`${where} has an unknown type "${String(node.type)}"`)
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!isNumber(node[key])) throw new CanvasError(`${where} has no ${key}`)
  }
  if (node.type === 'text' && !isString(node.text)) throw new CanvasError(`${where} has no text`)
  if (node.type === 'file' && !isString(node.file)) throw new CanvasError(`${where} has no file`)
  if (node.type === 'link' && !isString(node.url)) throw new CanvasError(`${where} has no url`)
  if (node.type === 'ink' && !Array.isArray(node.strokes)) {
    throw new CanvasError(`${where} has no strokes`)
  }
  return node as CanvasNode
}

function checkEdge(value: unknown, i: number, ids: Set<string>): CanvasEdge {
  const edge = value as Record<string, unknown>
  const where = `edge ${i + 1}`
  if (!edge || typeof edge !== 'object') throw new CanvasError(`${where} is not an object`)
  if (!isString(edge.id) || !edge.id) throw new CanvasError(`${where} has no id`)
  for (const key of ['fromNode', 'toNode']) {
    if (!isString(edge[key]) || !ids.has(edge[key] as string)) {
      throw new CanvasError(`${where} points to a box that does not exist`)
    }
  }
  for (const key of ['fromSide', 'toSide']) {
    if (edge[key] !== undefined && !SIDES.includes(edge[key] as Side)) {
      throw new CanvasError(`${where} has an unknown ${key}`)
    }
  }
  return edge as CanvasEdge
}

/** Reads a .canvas file. Throws CanvasError when it is damaged; an empty file is a new canvas. */
export function canvasFrom(text: string): CanvasData {
  if (!text.trim()) return { nodes: [], edges: [] }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new CanvasError('The canvas file is not valid JSON')
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new CanvasError('The canvas file is not a canvas')
  }
  const data = json as Record<string, unknown>
  const nodes = (data.nodes ?? []) as unknown[]
  const edges = (data.edges ?? []) as unknown[]
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new CanvasError('The canvas file has no list of nodes or edges')
  }
  const checked = nodes.map(checkNode)
  const ids = new Set(checked.map((n) => n.id))
  if (ids.size !== checked.length) throw new CanvasError('Two boxes in the canvas share an id')
  return { ...data, nodes: checked, edges: edges.map((e, i) => checkEdge(e, i, ids)) }
}

/** The file text: compact JSON with points on one line. */
export function formatCanvas(data: CanvasData): string {
  return compactJson(data) + '\n'
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The box around all nodes, or null for an empty canvas. */
export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height

/** The nodes inside a group: all that lie fully in its frame, nested groups too. */
export function inGroup(group: GroupNode, nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter((n) => n.id !== group.id && contains(group, n))
}

/** The point on a node's side where an edge starts or ends. */
export function sidePoint(rect: Rect, side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: rect.x + rect.width / 2, y: rect.y }
    case 'bottom':
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
    case 'left':
      return { x: rect.x, y: rect.y + rect.height / 2 }
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
  }
}

/** For an edge without sides: the sides of two boxes that face each other. */
export function facingSides(from: Rect, to: Rect): [Side, Side] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  // Compare in units of the boxes' sizes, so wide boxes side by side still connect left-right.
  const w = (from.width + to.width) / 2 || 1
  const h = (from.height + to.height) / 2 || 1
  if (Math.abs(dx) / w >= Math.abs(dy) / h) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export type Marker = 'none' | 'arrow' | 'triangle' | 'diamond' | 'diamond-filled'

export interface EdgeStyle {
  dashed: boolean
  fromMarker: Marker
  toMarker: Marker
}

/**
 * How a UML relation looks. The arrow points at the parent (inheritance, realization), at
 * what is used (dependency, directed); the diamond sits at the whole (aggregation, composition),
 * which is the `from` end.
 */
export function edgeStyle(edge: CanvasEdge): EdgeStyle {
  switch (edge.relation) {
    case 'inheritance':
      return { dashed: false, fromMarker: 'none', toMarker: 'triangle' }
    case 'realization':
      return { dashed: true, fromMarker: 'none', toMarker: 'triangle' }
    case 'dependency':
      return { dashed: true, fromMarker: 'none', toMarker: 'arrow' }
    case 'directed':
      return { dashed: false, fromMarker: 'none', toMarker: 'arrow' }
    case 'aggregation':
      return { dashed: false, fromMarker: 'diamond', toMarker: 'none' }
    case 'composition':
      return { dashed: false, fromMarker: 'diamond-filled', toMarker: 'none' }
    case 'association':
      return { dashed: false, fromMarker: 'none', toMarker: 'none' }
    default:
      // A plain JSON Canvas edge: an arrow at the end unless it says otherwise.
      return {
        dashed: false,
        fromMarker: edge.fromEnd === 'arrow' ? 'arrow' : 'none',
        toMarker: edge.toEnd === 'none' ? 'none' : 'arrow'
      }
  }
}

/** Sets a relation and the JSON Canvas ends that come closest to it, for Obsidian. */
export function withRelation(edge: CanvasEdge, relation: Relation | undefined): CanvasEdge {
  const next: CanvasEdge = { ...edge, relation }
  if (!relation) {
    delete next.relation
    return next
  }
  const style = edgeStyle(next)
  return {
    ...next,
    fromEnd: style.fromMarker === 'none' ? 'none' : 'arrow',
    toEnd: style.toMarker === 'none' ? 'none' : 'arrow'
  }
}

/** A class box's compartments: name, attributes, operations, split at lines of "---". */
export function compartments(text: string): string[] {
  return text.split(/^\s*-{3,}\s*$/m).map((part) => part.replace(/^\n+|\n+$/g, ''))
}

/** JSON Canvas presets "1" to "6" as notebook colour names. */
export const PRESET_COLORS: Record<string, string> = {
  '1': 'red',
  '2': 'orange',
  '3': 'yellow',
  '4': 'green',
  '5': 'teal',
  '6': 'pink'
}

/** A node or edge colour as a CSS value: a preset becomes its token, hex stays hex. */
export function cssColor(color: string | undefined): string | null {
  if (!color) return null
  const preset = PRESET_COLORS[color]
  if (preset) return `var(--nb-${preset})`
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : null
}

/** Text of a canvas for search: text boxes, group labels, edge labels and multiplicities. */
export function canvasText(data: CanvasData): string[] {
  const parts: string[] = []
  for (const node of data.nodes) {
    if (node.type === 'text') parts.push(node.text)
    else if (node.type === 'group' && node.label) parts.push(node.label)
    else if (node.type === 'link') parts.push(node.url)
  }
  for (const edge of data.edges) {
    const labels = [edge.fromLabel, edge.label, edge.toLabel].filter(Boolean)
    if (labels.length) parts.push(labels.join(' '))
  }
  return parts.filter((p) => p.trim())
}

let counter = 0

/** A short id like Obsidian's 16 hex characters. */
export function newCanvasId(): string {
  counter = (counter + 1) % 0x10000
  const time = Date.now().toString(16).slice(-8)
  const random = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  return `${time}${random}${counter.toString(16).padStart(4, '0')}`
}
