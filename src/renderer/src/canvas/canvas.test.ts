import { describe, expect, it } from 'vitest'
import type { CanvasData, CanvasNode, InkStroke, Rect } from '../../../shared/canvas'
import { fitCamera, toScreen, toWorld, zoomAt, zoomStep } from './camera'
import { createCanvasDoc } from './doc'
import { clickScale, makeScaled, templateByName } from './shapes'
import { sourceRange, wordAround } from './caret'
import { snapSpacing } from './spacing'
import { inheritedOperations, inOperations, insertOperations, operationName } from './overrides'
import {
  edgeGeometries,
  edgeGeometry,
  edgePorts,
  elbowRoute,
  freeEndSide,
  geometryOf,
  sideAt
} from './edges'
import {
  bringToFront,
  connect,
  connectTarget,
  copyItems,
  drawOrder,
  groupAround,
  moveNodes,
  movingSet,
  nearestSide,
  nodeAt,
  nodesIn,
  pasteItems,
  removeItems,
  resized,
  snapResized,
  withStroke
} from './ops'

const text = (id: string, x: number, y: number, w = 200, h = 100): CanvasNode => ({
  id,
  type: 'text',
  text: id,
  x,
  y,
  width: w,
  height: h
})

const CANVAS: CanvasData = {
  nodes: [
    { id: 'domain', type: 'group', label: 'Domain', x: -50, y: -50, width: 600, height: 300 },
    text('customer', 0, 0),
    text('order', 300, 0),
    text('invoice', 900, 0)
  ],
  edges: [
    { id: 'places', fromNode: 'customer', toNode: 'order' },
    { id: 'bills', fromNode: 'order', toNode: 'invoice' }
  ]
}

describe('camera', () => {
  it('keeps the point under the mouse fixed while zooming', () => {
    const camera = { x: 100, y: 50, zoom: 1 }
    const before = toWorld(camera, 400, 300)
    const zoomed = zoomAt(camera, 2, 400, 300)
    expect(toWorld(zoomed, 400, 300)).toEqual(before)
    expect(toScreen(zoomed, before.x, before.y)).toEqual({ x: 400, y: 300 })
  })

  it('stays between 10% and 400%', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 50, 0, 0).zoom).toBe(4)
    expect(zoomStep(4, 1)).toBe(4)
    expect(zoomStep(1, -1)).toBe(0.75)
    expect(zoomStep(0.8, 1)).toBe(1)
  })

  it('fits the content with a margin, never above 100%', () => {
    const small = fitCamera({ x: 0, y: 0, width: 100, height: 100 }, 800, 600)
    expect(small.zoom).toBe(1)
    expect(toScreen(small, 50, 50)).toEqual({ x: 400, y: 300 })
    const big = fitCamera({ x: 0, y: 0, width: 4000, height: 1000 }, 800, 600)
    expect(big.zoom).toBeCloseTo((800 - 96) / 4000)
  })
})

describe('ops', () => {
  it('moves what is inside a group along with it', () => {
    const moving = movingSet(CANVAS, ['domain'])
    expect([...moving].sort()).toEqual(['customer', 'domain', 'order'])
    const moved = moveNodes(CANVAS, CANVAS, moving, 10, 20)
    expect(moved.nodes.find((n) => n.id === 'order')).toMatchObject({ x: 310, y: 20 })
    expect(moved.nodes.find((n) => n.id === 'invoice')).toBe(CANVAS.nodes[3])
  })

  it('removes the edges of removed boxes', () => {
    const left = removeItems(CANVAS, { nodes: ['order'], edges: [] })
    expect(left.edges).toEqual([])
    expect(left.nodes.map((n) => n.id)).toEqual(['domain', 'customer', 'invoice'])
  })

  it('resizes from any handle and keeps a minimum size', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 }
    expect(resized(rect, 'se', 50, 20)).toEqual({ x: 0, y: 0, width: 250, height: 120 })
    expect(resized(rect, 'nw', 50, 20)).toEqual({ x: 50, y: 20, width: 150, height: 80 })
    expect(resized(rect, 'w', 500, 0).width).toBe(24)
    expect(resized(rect, 'se', 100, 0, true)).toEqual({ x: 0, y: 0, width: 300, height: 150 })
  })

  it('snaps the dragged sides of a resized box to lines nearby', () => {
    const rect = { x: 0, y: 0, width: 203, height: 97 }
    const se = snapResized(rect, 'se', [205, 400], [100], 6)
    expect(se).toEqual({ rect: { x: 0, y: 0, width: 205, height: 100 }, gx: 205, gy: 100 })
    // The left side moves when the left handle is dragged; nothing too far away snaps.
    const w = snapResized({ x: 10, y: 0, width: 190, height: 97 }, 'w', [4, 205], [300], 6)
    expect(w).toEqual({ rect: { x: 4, y: 0, width: 196, height: 97 }, gx: 4, gy: null })
  })

  it('selects with a dragged box: groups only when fully inside', () => {
    expect(nodesIn(CANVAS, { x: -10, y: -10, width: 400, height: 50 }).sort()).toEqual([
      'customer',
      'order'
    ])
    expect(nodesIn(CANVAS, { x: -60, y: -60, width: 700, height: 400 })).toContain('domain')
  })

  it('copies boxes with the edges between them, under new ids', () => {
    const copied = copyItems(CANVAS, ['customer', 'order'], 0, 0)
    expect(copied.nodes).toHaveLength(2)
    expect(copied.edges).toHaveLength(1)
    const ids = new Set(copied.nodes.map((n) => n.id))
    expect(ids.has('customer')).toBe(false)
    expect(ids.has(copied.edges[0].fromNode) && ids.has(copied.edges[0].toNode)).toBe(true)

    const pasted = pasteItems(CANVAS, copied, 1000, 1000)
    expect(pasted.data.nodes).toHaveLength(6)
    expect(pasted.selection.nodes).toHaveLength(2)
    const first = pasted.data.nodes.find((n) => n.id === pasted.selection.nodes[0])!
    expect(first).toMatchObject({ x: 1000, y: 1000 })
  })

  it('makes a group around boxes with room for its label', () => {
    const group = groupAround(CANVAS, ['customer', 'order'], 'Sales')!
    expect(group).toMatchObject({ type: 'group', label: 'Sales', x: -32, y: -60, width: 564 })
  })

  it('connects on facing sides and lands on the nearest side', () => {
    expect(connect(CANVAS, 'customer', 'order')).toMatchObject({
      fromSide: 'right',
      toSide: 'left'
    })
    expect(connect(CANVAS, 'order', 'order')).toBeNull()
    expect(nearestSide({ x: 0, y: 0, width: 200, height: 100 }, 190, 50)).toBe('right')
  })

  it('finds where a dragged arrow lands: the box under it, else a side near it', () => {
    expect(connectTarget(CANVAS, 250, 50, 40, 'customer')).toBeNull()
    // Just left of order's left side: snaps to it.
    expect(connectTarget(CANVAS, 280, 50, 40, 'customer')).toEqual({ id: 'order', side: 'left' })
    expect(connectTarget(CANVAS, 480, 90, 40)).toEqual({ id: 'order', side: 'bottom' })
    // Too far from any side, and the group never counts.
    expect(connectTarget(CANVAS, 700, 200, 40)).toBeNull()
  })

  it('finds the box under a point before the group around it', () => {
    expect(nodeAt(CANVAS, 50, 50)?.id).toBe('customer')
    expect(nodeAt(CANVAS, 250, 200)?.id).toBe('domain')
    expect(nodeAt(CANVAS, 2000, 2000)).toBeNull()
    expect(drawOrder(CANVAS.nodes)[0].id).toBe('domain')
  })

  it('brings boxes to the front only when needed', () => {
    expect(bringToFront(CANVAS, ['invoice'])).toBe(CANVAS)
    expect(bringToFront(CANVAS, ['customer']).nodes.at(-1)?.id).toBe('customer')
  })
})

describe('edges', () => {
  const a = { x: 0, y: 0, width: 200, height: 100 }
  const b = { x: 400, y: 0, width: 200, height: 100 }

  it('leaves and enters the boxes at right angles', () => {
    const g = edgeGeometry(a, 'right', b, 'left', 'none', 'arrow')
    expect(g.path.startsWith('M200.0,50.0 C')).toBe(true)
    expect(g.path.endsWith('400.0,50.0')).toBe(true)
    expect(g.middle).toEqual({ x: 300, y: 50 })
    expect(g.markers).toHaveLength(1)
  })

  it('stops the line at a hollow marker', () => {
    const g = edgeGeometry(a, 'right', b, 'left', 'diamond', 'triangle')
    expect(g.path.startsWith('M220.0,50.0')).toBe(true)
    expect(g.path.endsWith('384.0,50.0')).toBe(true)
    expect(g.markers.map((m) => m.fill)).toEqual(['background', 'background'])
  })

  it('points a free end back at its start', () => {
    expect(freeEndSide({ x: 0, y: 0 }, { x: 100, y: 10 })).toBe('left')
    expect(freeEndSide({ x: 0, y: 0 }, { x: 10, y: -100 })).toBe('bottom')
  })

  it('spreads arrows that meet one side, in the order of their other box', () => {
    const nodes = [text('parent', 200, 0), text('left', 0, 300), text('right', 400, 300)]
    const edges = [
      { id: 'r', fromNode: 'right', toNode: 'parent', toSide: 'bottom' as const },
      { id: 'l', fromNode: 'left', toNode: 'parent', toSide: 'bottom' as const }
    ]
    const ports = edgePorts(edges, new Map(nodes.map((n) => [n.id, n])))
    expect(ports.get('l')!.to).toBeCloseTo(1 / 3)
    expect(ports.get('r')!.to).toBeCloseTo(2 / 3)
    // Their own sides are not shared, so they stay in the middle.
    expect(ports.get('l')!.from).toBe(0.5)
  })

  it('puts a spread end on the outline of an ellipse or diamond', () => {
    const box = { x: 0, y: 0, width: 200, height: 100 }
    expect(sideAt(box, 'top', 0.25)).toEqual({ x: 50, y: 0 })
    expect(sideAt(box, 'top', 0.5, 'ellipse')).toEqual({ x: 100, y: 0 })
    const off = sideAt(box, 'top', 0, 'diamond')
    expect(off.x).toBeCloseTo(40)
    // On the diamond's edge: as far down as it is from the middle across.
    expect(off.y).toBeCloseTo(30)
  })
})

describe('doc', () => {
  it('makes a drag one undo step and keeps a change from elsewhere', () => {
    const doc = createCanvasDoc(CANVAS)
    const { begin, update, end, change, undo, redo } = doc.getState()
    begin()
    update((d) => moveNodes(d, doc.getState().started(), new Set(['invoice']), 5, 0))
    update((d) => moveNodes(d, doc.getState().started(), new Set(['invoice']), 50, 0))
    end()
    expect(doc.getState().past).toHaveLength(1)
    change((d) => removeItems(d, { nodes: ['customer'], edges: [] }))
    undo()
    undo()
    expect(doc.getState().data).toBe(CANVAS)
    redo()
    expect(doc.getState().data.nodes.find((n) => n.id === 'invoice')?.x).toBe(950)
  })

  it('cancel goes back to the start but keeps what changed meanwhile', () => {
    const doc = createCanvasDoc(CANVAS)
    const s = doc.getState()
    s.begin()
    s.update((d) => moveNodes(d, CANVAS, new Set(['order']), 100, 0))
    s.change((d) => removeItems(d, { nodes: ['invoice'], edges: [] }))
    s.cancel()
    const data = doc.getState().data
    expect(data.nodes.find((n) => n.id === 'order')?.x).toBe(300)
    expect(data.nodes.find((n) => n.id === 'invoice')).toBeUndefined()
  })

  it('drops what is gone from the selection after undo', () => {
    const doc = createCanvasDoc(CANVAS)
    const s = doc.getState()
    s.change((d) => ({ ...d, nodes: [...d.nodes, text('new', 0, 400)] }))
    s.select({ nodes: ['new', 'order'], edges: [] })
    s.undo()
    expect(doc.getState().selection.nodes).toEqual(['order'])
  })
})

describe('ink', () => {
  const stroke = (points: [number, number][]): InkStroke => ({
    color: '#cf222e',
    width: 2,
    points: points.map(([x, y]) => [x, y, 0.5])
  })

  it('starts a drawing around a stroke, with points relative to it', () => {
    const node = withStroke(
      null,
      stroke([
        [100, 100],
        [140, 120]
      ])
    )
    expect(node).toMatchObject({ type: 'ink', x: 96, y: 96, width: 48, height: 28 })
    expect(node.strokes[0].points[0]).toEqual([4, 4, 0.5])
  })

  it('puts a stroke close by into the same drawing, which grows', () => {
    const first = withStroke(
      null,
      stroke([
        [100, 100],
        [140, 120]
      ])
    )
    const both = withStroke(
      first,
      stroke([
        [80, 110],
        [90, 130]
      ])
    )
    expect(both.id).toBe(first.id)
    expect(both.x).toBe(76)
    expect(both.strokes).toHaveLength(2)
    // The first stroke stays where it was in the world.
    expect(both.strokes[0].points[0][0] + both.x).toBe(100)
  })

  it('starts a new drawing far away', () => {
    const first = withStroke(
      null,
      stroke([
        [100, 100],
        [140, 120]
      ])
    )
    expect(
      withStroke(
        first,
        stroke([
          [900, 900],
          [950, 950]
        ])
      ).id
    ).not.toBe(first.id)
  })
})

describe('operations from a superclass', () => {
  const node = (id: string, text: string): CanvasNode => ({
    id,
    type: 'text',
    shape: 'class',
    text,
    x: 0,
    y: 0,
    width: 200,
    height: 120
  })
  const data: CanvasData = {
    nodes: [
      node('shape', '«interface»\nShape\n---\n+ area(): double\n+ draw(g: Graphics)'),
      node(
        'poly',
        '*Polygon*\n---\n- sides: int\n---\n+ *perimeter(): double*\n+ draw(g: Graphics)'
      ),
      node('square', 'Square\n---\n- side: double\n---\n+ draw(g: Graphics)')
    ],
    edges: [
      { id: 'e1', fromNode: 'poly', toNode: 'shape', relation: 'realization' },
      { id: 'e2', fromNode: 'square', toNode: 'poly', relation: 'inheritance' }
    ]
  }

  it('are the ones up the arrows that the class does not have yet, as it writes them', () => {
    expect(inheritedOperations(data, 'square')).toEqual([
      '+ perimeter(): double',
      '+ area(): double'
    ])
    expect(inheritedOperations(data, 'shape')).toEqual([])
  })

  it('go in the operations part, in place of the line being typed', () => {
    const text = 'Square\n---\n- side: double\n---\n+ draw(g: Graphics)\n+ '
    expect(inOperations(text, text.length)).toBe(true)
    expect(inOperations(text, 12)).toBe(false)
    const done = insertOperations(text, text.length, ['+ area(): double', '+ perimeter(): double'])
    expect(done.text).toBe(
      'Square\n---\n- side: double\n---\n+ draw(g: Graphics)\n+ area(): double\n+ perimeter(): double'
    )
    expect(done.cursor).toBe(done.text.length)
    expect(operationName('+ *perimeter(): double* {abstract}')).toBe('perimeter')
  })
})

describe('right-angle arrows', () => {
  const straight = (points: { x: number; y: number }[]): boolean =>
    points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y)

  it('go straight between boxes side by side, and bend once around a corner', () => {
    expect(elbowRoute({ x: 100, y: 50 }, 'right', { x: 300, y: 50 }, 'left', [])).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 }
    ])
    const corner = elbowRoute({ x: 100, y: 50 }, 'right', { x: 400, y: 300 }, 'top', [])
    expect(corner).toHaveLength(3)
    expect(corner[1]).toEqual({ x: 400, y: 50 })
  })

  it('go around a box in the way, with only straight pieces', () => {
    const wall = { x: 180, y: -100, width: 40, height: 300 }
    const route = elbowRoute({ x: 100, y: 50 }, 'right', { x: 300, y: 50 }, 'left', [wall])
    expect(straight(route)).toBe(true)
    expect(route.some((p) => p.y < wall.y || p.y > wall.y + wall.height)).toBe(true)
  })

  it('avoid crossing arrows already there when a route as good does not', () => {
    const start = { x: 0, y: 0 }
    const end = { x: 300, y: 200 }
    expect(elbowRoute(start, 'right', end, 'left', []).some((p) => p.x === 150)).toBe(true)
    const other: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 100, y: -50 },
      { x: 100, y: 100 }
    ]
    const route = elbowRoute(start, 'right', end, 'left', [], [other])
    expect(route.some((p) => p.x === 150)).toBe(false)
    expect(straight(route)).toBe(true)
  })

  // Horizontal pieces of a drawn path: the points of M, L and the ends of Q, two by two.
  const flatPieces = (path: string): [number, number, number][] => {
    const points = [...path.matchAll(/[MLQ][^MLQA]*/g)].map((m) => {
      const numbers = m[0].slice(1).trim().split(/[ ,]+/).map(Number)
      return { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] }
    })
    return points
      .slice(1)
      .map((p, i): [number, number, number] => [points[i].y, points[i].x, p.x])
      .filter(([y, a, b], i) => Math.abs(points[i + 1].y - y) < 0.01 && Math.abs(a - b) > 1)
  }

  it('keep the arrows of subclasses on one level apart, without crossing', () => {
    const parent = text('shape', 400, 0, 200, 100)
    const children = [0, 220, 640, 860].map((x, i) => text(`c${i}`, x, 300, 160, 80))
    const byId = new Map([parent, ...children].map((n) => [n.id, n]))
    const edges = children.map((c) => ({
      id: `is-${c.id}`,
      fromNode: c.id,
      toNode: 'shape',
      relation: 'inheritance' as const,
      route: 'elbow' as const
    }))
    const paths = [...edgeGeometries(edges, byId).values()].map((g) => g.path)
    expect(paths).toHaveLength(4)
    // Nothing to hop over.
    for (const path of paths) expect(path).not.toContain('A')
    const pieces = paths.map(flatPieces)
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        for (const [y1, a1, b1] of pieces[i]) {
          for (const [y2, a2, b2] of pieces[j]) {
            const overlap =
              Math.min(Math.max(a1, b1), Math.max(a2, b2)) -
              Math.max(Math.min(a1, b1), Math.min(a2, b2))
            expect(Math.abs(y1 - y2) > 1 || overlap <= 1).toBe(true)
          }
        }
      }
    }
  })

  it('hop over an arrow they have to cross', () => {
    const nodes = [
      text('a', 0, 100, 100, 80),
      text('b', 600, 100, 100, 80),
      text('c', 280, -200, 120, 80),
      text('d', 280, 400, 120, 80)
    ]
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const geometries = edgeGeometries(
      [
        { id: 'across', fromNode: 'a', toNode: 'b', route: 'elbow' },
        { id: 'down', fromNode: 'c', toNode: 'd', route: 'elbow' }
      ],
      byId
    )
    expect(geometries.get('across')!.path).toContain('A')
    expect(geometries.get('down')!.path).not.toContain('A')
  })

  it('are drawn when an edge asks for them', () => {
    const a: CanvasNode = { id: 'a', type: 'text', text: 'A', x: 0, y: 0, width: 100, height: 100 }
    const b: CanvasNode = { ...a, id: 'b', x: 300, y: 300 }
    const byId = new Map([a, b].map((n) => [n.id, n]))
    const edge = { id: 'e', fromNode: 'a', toNode: 'b' }
    expect(geometryOf(edge, byId)!.path).toContain('C')
    const elbow = geometryOf({ ...edge, route: 'elbow' as const }, byId)!.path
    expect(elbow).not.toContain('C')
    expect(elbow).toContain('Q')
  })
})

describe('equal spacing', () => {
  const box = (x: number, y = 0, width = 100, height = 50): Rect => ({ x, y, width, height })

  it('repeats a space already in the row', () => {
    // A and B 40 apart; the moved box lands 40 after B.
    const snap = snapSpacing(box(283), [box(0), box(140)], 'x', 6)
    expect(snap?.delta).toBe(-3)
    expect(snap?.gaps).toEqual([
      { x1: 240, y1: 25, x2: 280, y2: 25 },
      { x1: 100, y1: 25, x2: 140, y2: 25 }
    ])
  })

  it('centres between two neighbours', () => {
    const snap = snapSpacing(box(202), [box(0), box(400)], 'x', 6)
    expect(snap?.delta).toBe(-2)
    expect(snap?.gaps.map((g) => g.x2 - g.x1)).toEqual([100, 100])
  })

  it('works along columns, and ignores boxes in another row or out of reach', () => {
    const column = [box(0, 0), box(0, 80)]
    expect(snapSpacing(box(0, 162), column, 'y', 6)?.delta).toBe(-2)
    expect(snapSpacing(box(283, 300), [box(0), box(140)], 'x', 6)).toBeNull()
    expect(snapSpacing(box(300), [box(0), box(140)], 'x', 6)).toBeNull()
  })
})

describe('a double-clicked word', () => {
  const cls = 'Order\n---\n- placed: Date\n- total: float\n---\n+ total(): float'
  const range = (text: string, part: number | null, shown: string, word: string): string => {
    const r = sourceRange(text, part, shown, shown.indexOf(word) + 1)
    return r ? `${r[0]}:${text.slice(...r)}` : 'none'
  }

  it('is found in the compartment of the class it was drawn in', () => {
    expect(range(cls, 0, 'Order', 'Order')).toBe('0:Order')
    expect(range(cls, 1, '- total: float', 'total')).toBe('27:total')
    // The same word in the operations is another one.
    expect(range(cls, 2, '+ total(): float', 'total')).toBe(`${cls.lastIndexOf('total')}:total`)
  })

  it('is found through Markdown marks, and not on a symbol', () => {
    const text = 'The **gain** of a split'
    expect(range(text, null, 'gain', 'gain')).toBe('6:gain')
    expect(sourceRange('a + b', null, 'a + b', 2)).toBeNull()
  })

  it('takes the same occurrence when a word comes twice on a line', () => {
    const text = 'Type maps Type'
    expect(sourceRange(text, null, text, 12)).toEqual([10, 14])
    expect(wordAround('a: Type', 4)).toEqual([3, 7])
  })
})

describe('shapes', () => {
  const cls = templateByName('Class')!

  it('comes out at a normal size on screen when added zoomed out', () => {
    expect(clickScale(1.5)).toBe(1)
    expect(clickScale(0.5)).toBe(2)
    expect(clickScale(0.05)).toBe(4)
    const node = makeScaled(cls, { x: 0, y: 0 }, 2)
    expect(node).toMatchObject({ x: -240, y: -150, width: 480, height: 300, fontScale: 2 })
    expect(makeScaled(cls, { x: 0, y: 0 }, 1).fontScale).toBeUndefined()
  })

  it('takes a dragged rectangle, its text growing with it', () => {
    const rect = { x: 10, y: 20, width: 720, height: 300 }
    // 3 times as wide but 2 times as tall as the template: the text follows the smaller.
    expect(makeScaled(cls, rect, 1, rect)).toMatchObject({ ...rect, fontScale: 2 })
  })

  it('keeps start and end dots round', () => {
    const start = templateByName('Start')!
    const node = makeScaled(start, { x: 0, y: 0 }, 1, { x: 0, y: 0, width: 90, height: 30 })
    expect(node.width).toBe(node.height)
    expect(node.fontScale).toBeUndefined()
  })
})
