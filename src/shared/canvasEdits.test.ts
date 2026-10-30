import { describe, expect, it } from 'vitest'
import type { CanvasData, CanvasEdge, CanvasNode } from './canvas'
import { canvasEdits } from './canvasEdits'

const box = (id: string, text: string, shape = 'class'): CanvasNode =>
  ({ id, type: 'text', text, shape, x: 0, y: 0, width: 200, height: 100 }) as CanvasNode

const arrow = (
  id: string,
  from: string,
  to: string,
  extra: Partial<CanvasEdge> = {}
): CanvasEdge => ({
  id,
  fromNode: from,
  toNode: to,
  ...extra
})

const drawn: CanvasData = {
  nodes: [
    box('order', 'Order\n---\n- id: int\n---\n+ total(): double'),
    box('customer', '**Customer**\n---\n- name: String'),
    box('line', 'OrderLine\n---\n- quantity: int')
  ],
  edges: [
    arrow('places', 'customer', 'order', {
      relation: 'association',
      fromLabel: '1',
      toLabel: '0..*'
    }),
    arrow('has', 'order', 'line', { relation: 'aggregation' })
  ]
}

describe('canvasEdits', () => {
  it('says nothing when boxes only moved or were resized', () => {
    const moved = {
      ...drawn,
      nodes: drawn.nodes.map((n) => ({ ...n, x: n.x + 40, width: 260 }))
    }
    expect(canvasEdits(drawn, moved)).toEqual([])
  })

  it('names changed attributes, relations and multiplicities by class name', () => {
    const edited: CanvasData = {
      nodes: [
        box('order', 'Order\n---\n- orderId: String\n---\n+ total(): double'),
        drawn.nodes[1],
        drawn.nodes[2]
      ],
      edges: [
        { ...drawn.edges[0], toLabel: '1..*' },
        { ...drawn.edges[1], relation: 'composition' }
      ]
    }
    expect(canvasEdits(drawn, edited)).toEqual([
      'In "Order": removed "- id: int"; added "- orderId: String"',
      'Multiplicity at "Order" of the arrow "Customer" -> "Order": "1..*" (was "0..*")',
      'The arrow "Order" -> "OrderLine": aggregation became composition'
    ])
  })

  it('lists added and removed boxes and arrows with what they hold', () => {
    const edited: CanvasData = {
      nodes: [...drawn.nodes.slice(0, 2), box('pay', 'Payment\n---\n- amount: double')],
      edges: [drawn.edges[0], arrow('pays', 'order', 'pay', { relation: 'association' })]
    }
    expect(canvasEdits(drawn, edited)).toEqual([
      'Added class "Payment" (- amount: double)',
      'Removed class "OrderLine" (- quantity: int)',
      'Added the arrow "Order" -> "Payment" (association)',
      'Removed the arrow "Order" -> "OrderLine" (aggregation)'
    ])
  })

  it('treats an arrow drawn again between the same boxes as a change, also turned around', () => {
    const edited: CanvasData = {
      ...drawn,
      edges: [drawn.edges[0], arrow('new', 'line', 'order', { relation: 'composition' })]
    }
    expect(canvasEdits(drawn, edited)).toEqual([
      'Turned around the arrow "Order" -> "OrderLine": now "OrderLine" -> "Order"',
      'The arrow "OrderLine" -> "Order": aggregation became composition'
    ])
  })

  it('keeps multiplicities with their box when an arrow is turned around', () => {
    const edited: CanvasData = {
      ...drawn,
      edges: [
        {
          ...drawn.edges[0],
          fromNode: 'order',
          toNode: 'customer',
          fromLabel: '0..*',
          toLabel: '1'
        },
        drawn.edges[1]
      ]
    }
    expect(canvasEdits(drawn, edited)).toEqual([
      'Turned around the arrow "Customer" -> "Order": now "Order" -> "Customer"'
    ])
  })

  it('notices a class that became an interface or a note', () => {
    const edited: CanvasData = {
      ...drawn,
      nodes: [
        box('order', '«interface»\nOrder\n---\n- id: int\n---\n+ total(): double'),
        ...drawn.nodes.slice(1)
      ]
    }
    expect(canvasEdits(drawn, edited)).toEqual(['In "Order": added "«interface»"'])
    const note: CanvasData = {
      ...drawn,
      nodes: [{ ...drawn.nodes[0], shape: 'note' } as CanvasNode, ...drawn.nodes.slice(1)]
    }
    expect(canvasEdits(drawn, note)).toEqual(['"Order": class became note'])
  })
})
