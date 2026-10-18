import {
  boundsOf,
  compartments,
  newCanvasId,
  RELATIONS,
  SHAPES,
  withRelation,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Rect,
  type Relation,
  type Shape,
  type Side
} from '../../../shared/canvas'
import { removeItems } from './ops'

// Claude's canvas edits: a list of changes (from the edit_canvas tool) applied as one step.
// Pure, so the preview and the real change come from the same function.

export interface CanvasChange {
  op: 'add_box' | 'change_box' | 'add_arrow' | 'change_arrow' | 'delete'
  id?: string
  ids?: string[]
  type?: 'text' | 'group'
  shape?: string
  text?: string
  label?: string
  x?: number
  y?: number
  width?: number
  height?: number
  color?: string
  from?: string
  to?: string
  relation?: string
  arrow_label?: string
  from_label?: string
  to_label?: string
  from_side?: string
  to_side?: string
}

export interface EditResult {
  data: CanvasData
  /** Claude's ids for the boxes and arrows it added, mapped to the ids they got. */
  added: Map<string, string>
  errors: string[]
  /** Where the changes are, to show them when I click the change. */
  area: Rect | null
}

const SIDES: Side[] = ['top', 'right', 'bottom', 'left']
const CHAR_WIDTH = 8.4
const LINE_HEIGHT = 22
const GAP_X = 90
const GAP_Y = 110

/** A size that fits the text: about 8 points per character at 16 px, wider for a class. */
export function sizeFor(text: string, shape: Shape | undefined): { width: number; height: number } {
  if (shape === 'initial') return { width: 30, height: 30 }
  if (shape === 'final') return { width: 34, height: 34 }
  if (shape === 'actor') return { width: 90, height: 130 }
  const lines = text.split('\n').filter((l) => !/^\s*-{3,}\s*$/.test(l))
  const longest = Math.max(8, ...lines.map((l) => l.length))
  const parts = shape === 'class' ? compartments(text).length : 1
  let width = Math.min(420, Math.round(longest * CHAR_WIDTH + 36))
  let height = Math.round(Math.max(1, lines.length) * LINE_HEIGHT + parts * 14 + 10)
  if (shape === 'ellipse' || shape === 'circle') {
    width = Math.round(width * 1.35)
    height = Math.round(height * 1.5)
  }
  if (shape === 'diamond') {
    width = Math.max(70, Math.round(width * 1.5))
    height = Math.max(70, Math.round(height * 1.6))
  }
  return { width: Math.max(60, width), height: Math.max(40, height) }
}

/**
 * Places boxes that came without a position: in layers along the arrows between them (a
 * parent class above its children, the whole above its parts), next to what is there already.
 */
export function placeBoxes(
  data: CanvasData,
  ids: string[],
  start: { x: number; y: number }
): CanvasData {
  if (!ids.length) return data
  const placing = new Set(ids)
  // Arrows point "down" from the box that goes above.
  const down = new Map<string, string[]>()
  for (const edge of data.edges) {
    if (!placing.has(edge.fromNode) || !placing.has(edge.toNode)) continue
    const upward = edge.relation === 'inheritance' || edge.relation === 'realization'
    const [top, bottom] = upward ? [edge.toNode, edge.fromNode] : [edge.fromNode, edge.toNode]
    down.set(top, [...(down.get(top) ?? []), bottom])
  }
  // Longest path from a box nothing points down to; cycles are cut where they are found.
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = [...down.entries()].filter(([, kids]) => kids.includes(id)).map(([p]) => p)
    const d = parents.length ? Math.max(...parents.map((p) => depth(p) + 1)) : 0
    visiting.delete(id)
    layer.set(id, d)
    return d
  }
  ids.forEach(depth)
  const layers: string[][] = []
  for (const id of ids) (layers[layer.get(id)!] ??= []).push(id)

  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const placed = new Map<string, { x: number; y: number }>()
  let y = start.y
  for (const row of layers.filter(Boolean)) {
    // Under their parents where possible: order a layer by the middle of the parents.
    const centre = (id: string): number => {
      const parents = [...down.entries()].filter(([, kids]) => kids.includes(id)).map(([p]) => p)
      const xs = parents.map((p) => placed.get(p)?.x).filter((x): x is number => x !== undefined)
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity
    }
    const ordered = [...row].sort((a, b) => centre(a) - centre(b))
    let x = start.x
    let tallest = 0
    for (const id of ordered) {
      const node = byId.get(id)!
      placed.set(id, { x, y })
      x += node.width + GAP_X
      tallest = Math.max(tallest, node.height)
    }
    y += tallest + GAP_Y
  }
  return {
    ...data,
    nodes: data.nodes.map((n) => {
      const at = placed.get(n.id)
      return at ? { ...n, x: Math.round(at.x), y: Math.round(at.y) } : n
    })
  }
}

const shapeOf = (value: string | undefined): Shape | undefined =>
  SHAPES.includes(value as Shape) && value !== 'rectangle' ? (value as Shape) : undefined

const relationOf = (value: string | undefined): Relation | undefined =>
  RELATIONS.includes(value as Relation) ? (value as Relation) : undefined

const sideOf = (value: string | undefined): Side | undefined =>
  SIDES.includes(value as Side) ? (value as Side) : undefined

const validColor = (value: string | undefined): string | undefined =>
  value && (/^[1-6]$/.test(value) || /^#[0-9a-f]{6}$/i.test(value)) ? value : undefined

function cleaned<T extends object>(item: T): T {
  const out = { ...item }
  for (const key of Object.keys(out) as (keyof T)[]) if (out[key] === undefined) delete out[key]
  return out
}

/**
 * Applies Claude's changes. `start` is where boxes without a position go (right of what is on
 * the canvas). Bad changes are skipped and reported; the rest still happen.
 */
export function applyChanges(data: CanvasData, changes: CanvasChange[]): EditResult {
  let next = data
  const errors: string[] = []
  const added = new Map<string, string>()
  const unplaced: string[] = []
  const touched: string[] = []
  const taken = new Set([...data.nodes, ...data.edges].map((i) => i.id))
  // Claude's own ids work in later changes of the same call.
  const real = (id: string | undefined): string | undefined => (id ? (added.get(id) ?? id) : id)
  const freshId = (wanted: string | undefined): string => {
    const id = wanted && /^[\w-]{1,40}$/.test(wanted) && !taken.has(wanted) ? wanted : newCanvasId()
    taken.add(id)
    if (wanted) added.set(wanted, id)
    return id
  }
  const node = (id: string | undefined): CanvasNode | undefined =>
    next.nodes.find((n) => n.id === real(id))
  const edge = (id: string | undefined): CanvasEdge | undefined =>
    next.edges.find((e) => e.id === real(id))

  changes.forEach((c, i) => {
    const where = `change ${i + 1} (${c.op})`
    switch (c.op) {
      case 'add_box': {
        const group = c.type === 'group'
        const shape = group ? undefined : shapeOf(c.shape)
        const text = c.text ?? ''
        const size = sizeFor(group ? (c.label ?? '') : text, shape)
        const id = freshId(c.id)
        const box = cleaned({
          id,
          type: group ? 'group' : 'text',
          ...(group ? { label: c.label ?? '' } : { text, shape }),
          x: Math.round(c.x ?? 0),
          y: Math.round(c.y ?? 0),
          width: Math.round(c.width ?? (group ? 480 : size.width)),
          height: Math.round(c.height ?? (group ? 320 : size.height)),
          color: validColor(c.color)
        }) as CanvasNode
        next = { ...next, nodes: [...next.nodes, box] }
        if (c.x === undefined || c.y === undefined) unplaced.push(id)
        touched.push(id)
        return
      }
      case 'change_box': {
        const target = node(c.id)
        if (!target) return void errors.push(`${where}: no box "${c.id}"; use read_canvas for ids`)
        const updated: Record<string, unknown> = { ...target }
        // An empty string clears a colour or a shape; undefined leaves a field as it is.
        const put = (key: string, value: unknown, keep = value !== undefined): void => {
          if (!keep) return
          if (value === undefined) delete updated[key]
          else updated[key] = value
        }
        put('x', c.x)
        put('y', c.y)
        put('width', c.width)
        put('height', c.height)
        put('color', validColor(c.color), c.color !== undefined)
        if (target.type === 'text') {
          put('text', c.text)
          put('shape', shapeOf(c.shape), c.shape !== undefined)
        }
        if (target.type === 'group') put('label', c.label)
        next = {
          ...next,
          nodes: next.nodes.map((n) => (n === target ? (updated as CanvasNode) : n))
        }
        touched.push(target.id)
        return
      }
      case 'add_arrow': {
        const from = node(c.from)
        const to = node(c.to)
        if (!from || !to) return void errors.push(`${where}: no box "${from ? c.to : c.from}"`)
        const id = freshId(c.id)
        const arrow = withRelation(
          cleaned({
            id,
            fromNode: from.id,
            fromSide: sideOf(c.from_side),
            toNode: to.id,
            toSide: sideOf(c.to_side),
            label: c.arrow_label || undefined,
            fromLabel: c.from_label || undefined,
            toLabel: c.to_label || undefined,
            color: validColor(c.color)
          }),
          relationOf(c.relation)
        )
        next = { ...next, edges: [...next.edges, arrow] }
        touched.push(from.id, to.id)
        return
      }
      case 'change_arrow': {
        const target = edge(c.id)
        if (!target) return void errors.push(`${where}: no arrow "${c.id}"`)
        let updated: CanvasEdge = { ...target }
        const set = (key: keyof CanvasEdge, value: string | undefined): void => {
          if (value === undefined) return
          if (value === '') delete updated[key]
          else (updated as Record<string, unknown>)[key] = value
        }
        set('label', c.arrow_label)
        set('fromLabel', c.from_label)
        set('toLabel', c.to_label)
        if (c.from_side !== undefined) set('fromSide', sideOf(c.from_side) ?? '')
        if (c.to_side !== undefined) set('toSide', sideOf(c.to_side) ?? '')
        if (c.color !== undefined) set('color', c.color === '' ? '' : validColor(c.color))
        if (c.relation !== undefined) updated = withRelation(updated, relationOf(c.relation))
        next = { ...next, edges: next.edges.map((e) => (e === target ? updated : e)) }
        touched.push(target.fromNode, target.toNode)
        return
      }
      case 'delete': {
        const ids = (c.ids ?? (c.id ? [c.id] : [])).map(real)
        const boxes = ids.filter((id): id is string => !!id && !!node(id))
        const arrows = ids.filter((id): id is string => !!id && !!edge(id))
        const missing = ids.filter((id) => id && !boxes.includes(id) && !arrows.includes(id))
        if (missing.length) errors.push(`${where}: nothing with id ${missing.join(', ')}`)
        touched.push(...boxes)
        next = removeItems(next, { nodes: boxes, edges: arrows })
        return
      }
      default:
        errors.push(`${where}: unknown op`)
    }
  })

  if (unplaced.length) {
    // Right of the boxes that were there before, at the height of their top.
    const before = boundsOf(next.nodes.filter((n) => !unplaced.includes(n.id)))
    const start = before ? { x: before.x + before.width + 160, y: before.y } : { x: 0, y: 0 }
    next = placeBoxes(next, unplaced, start)
  }
  const area = boundsOf(next.nodes.filter((n) => touched.includes(n.id)))
  return { data: next, added, errors, area }
}

/** read_canvas: every box with its id, shape, place and text, then every arrow. */
export function describeCanvas(path: string, data: CanvasData): string {
  const lines = [`Canvas ${path}: ${data.nodes.length} boxes, ${data.edges.length} arrows.`]
  if (!data.nodes.length) lines.push('It is empty.')
  const place = (n: CanvasNode): string =>
    `at x=${Math.round(n.x)} y=${Math.round(n.y)}, ${Math.round(n.width)}x${Math.round(n.height)}`
  for (const n of data.nodes) {
    const color = n.color ? `, colour ${n.color}` : ''
    if (n.type === 'text') {
      lines.push(`- box ${n.id} (${n.shape ?? 'rectangle'}${color}) ${place(n)}:`, indent(n.text))
    } else if (n.type === 'group') {
      lines.push(`- group ${n.id} "${n.label ?? ''}"${color} ${place(n)}`)
    } else if (n.type === 'file') {
      lines.push(`- file ${n.id} ${n.file} ${place(n)}`)
    } else if (n.type === 'link') {
      lines.push(`- link ${n.id} ${n.url} ${place(n)}`)
    } else {
      lines.push(`- drawing ${n.id} (${n.strokes.length} pen strokes) ${place(n)}`)
    }
  }
  for (const e of data.edges) {
    const ends = [e.fromLabel && `from "${e.fromLabel}"`, e.toLabel && `to "${e.toLabel}"`]
    const extra = [e.label && `"${e.label}"`, ...ends].filter(Boolean).join(', ')
    lines.push(
      `- arrow ${e.id}: ${e.fromNode} -> ${e.toNode} (${e.relation ?? 'arrow'})${extra ? ` ${extra}` : ''}`
    )
  }
  return lines.join('\n')
}

const indent = (text: string): string =>
  text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n')
