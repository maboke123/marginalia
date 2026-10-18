import { describe, expect, it } from 'vitest'
import type { CanvasData, CanvasNode, InkStroke } from '../../../shared/canvas'
import { fitCamera, toScreen, toWorld, zoomAt, zoomStep } from './camera'
import { createCanvasDoc } from './doc'
import { edgeGeometry, freeEndSide } from './edges'
import {
  bringToFront,
  connect,
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
