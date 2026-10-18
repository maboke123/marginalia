import { describe, expect, it } from 'vitest'
import {
  canvasFrom,
  canvasText,
  CanvasError,
  compartments,
  cssColor,
  edgeStyle,
  facingSides,
  formatCanvas,
  inGroup,
  withRelation,
  type CanvasData,
  type GroupNode
} from './canvas'

// A canvas as Obsidian writes it, with a field of a newer Obsidian we do not know.
const OBSIDIAN = JSON.stringify({
  nodes: [
    { id: 'a1', type: 'text', text: 'Customer', x: -360, y: 0, width: 200, height: 110 },
    { id: 'b2', type: 'text', text: 'Order', x: 0, y: 0, width: 220, height: 140, color: '4' },
    { id: 'g3', type: 'group', label: 'Domain', x: -400, y: -60, width: 680, height: 260 }
  ],
  edges: [{ id: 'e1', fromNode: 'a1', fromSide: 'right', toNode: 'b2', toSide: 'left' }],
  metadata: { version: '1.0-1.0' }
})

describe('canvasFrom', () => {
  it('reads a canvas from Obsidian and keeps what it does not know', () => {
    const data = canvasFrom(OBSIDIAN)
    expect(data.nodes).toHaveLength(3)
    expect(canvasFrom(formatCanvas(data))).toEqual(data)
    expect(formatCanvas(data)).toContain('"metadata"')
  })

  it('treats an empty file as an empty canvas', () => {
    expect(canvasFrom('')).toEqual({ nodes: [], edges: [] })
    expect(canvasFrom('{}')).toEqual({ nodes: [], edges: [] })
  })

  it('refuses damaged files', () => {
    expect(() => canvasFrom('{"nodes": [')).toThrow(CanvasError)
    expect(() => canvasFrom('[]')).toThrow(CanvasError)
    expect(() => canvasFrom('{"nodes":[{"id":"a","type":"text","x":0,"y":0}]}')).toThrow(/no width/)
    expect(() =>
      canvasFrom(
        '{"nodes":[{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1}],' +
          '"edges":[{"id":"e","fromNode":"a","toNode":"gone"}]}'
      )
    ).toThrow(/does not exist/)
  })

  it('keeps stroke points on one line', () => {
    const data: CanvasData = {
      nodes: [
        {
          id: 'ink',
          type: 'ink',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          strokes: [
            {
              color: '#cf222e',
              width: 2,
              points: [
                [0, 0, 0.5],
                [4, 2, 0.5]
              ]
            }
          ]
        }
      ],
      edges: []
    }
    expect(formatCanvas(data)).toContain('"points": [[0,0,0.5],[4,2,0.5]]')
  })
})

describe('UML relations', () => {
  const edge = { id: 'e', fromNode: 'a', toNode: 'b' }

  it('draws plain edges like Obsidian: an arrow at the end', () => {
    expect(edgeStyle(edge)).toEqual({ dashed: false, fromMarker: 'none', toMarker: 'arrow' })
    expect(edgeStyle({ ...edge, toEnd: 'none' }).toMarker).toBe('none')
  })

  it('draws relations with their UML markers', () => {
    expect(edgeStyle({ ...edge, relation: 'realization' })).toEqual({
      dashed: true,
      fromMarker: 'none',
      toMarker: 'triangle'
    })
    expect(edgeStyle({ ...edge, relation: 'composition' }).fromMarker).toBe('diamond-filled')
  })

  it('sets the closest Obsidian ends with a relation', () => {
    expect(withRelation(edge, 'composition')).toMatchObject({ fromEnd: 'arrow', toEnd: 'none' })
    expect(withRelation(edge, 'association')).toMatchObject({ fromEnd: 'none', toEnd: 'none' })
    expect(withRelation({ ...edge, relation: 'inheritance' }, undefined)).not.toHaveProperty(
      'relation'
    )
  })
})

describe('geometry', () => {
  it('connects boxes on the sides that face each other', () => {
    const a = { x: 0, y: 0, width: 200, height: 100 }
    expect(facingSides(a, { x: 400, y: 30, width: 200, height: 100 })).toEqual(['right', 'left'])
    expect(facingSides(a, { x: 20, y: 300, width: 200, height: 100 })).toEqual(['bottom', 'top'])
    expect(facingSides(a, { x: -400, y: 0, width: 200, height: 100 })).toEqual(['left', 'right'])
  })

  it('finds what lies inside a group', () => {
    const data = canvasFrom(OBSIDIAN)
    const group = data.nodes.find((n) => n.type === 'group') as GroupNode
    expect(inGroup(group, data.nodes).map((n) => n.id)).toEqual(['a1', 'b2'])
  })
})

describe('text', () => {
  it('splits a class into name, attributes and operations', () => {
    expect(compartments('Order\n---\n- id: int\n---\n+ total(): float')).toEqual([
      'Order',
      '- id: int',
      '+ total(): float'
    ])
  })

  it('maps preset colours to notebook tokens', () => {
    expect(cssColor('4')).toBe('var(--nb-green)')
    expect(cssColor('#cf222e')).toBe('#cf222e')
    expect(cssColor('red; background: url(x)')).toBeNull()
  })

  it('collects the text to search', () => {
    expect(canvasText(canvasFrom(OBSIDIAN))).toEqual(['Customer', 'Order', 'Domain'])
  })
})
