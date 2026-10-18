import { describe, expect, it } from 'vitest'
import { EMPTY_CANVAS, type CanvasData } from '../../../shared/canvas'
import { applyChanges, describeCanvas, sizeFor, type CanvasChange } from './claudeEdits'

const CLASSES: CanvasChange[] = [
  {
    op: 'add_box',
    id: 'animal',
    shape: 'class',
    text: 'Animal\n---\n- name: String\n---\n+ speak()'
  },
  { op: 'add_box', id: 'dog', shape: 'class', text: 'Dog\n---\n+ speak()' },
  { op: 'add_box', id: 'cat', shape: 'class', text: 'Cat\n---\n+ speak()' },
  { op: 'add_arrow', from: 'dog', to: 'animal', relation: 'inheritance' },
  { op: 'add_arrow', from: 'cat', to: 'animal', relation: 'inheritance' }
]

const at = (data: CanvasData, id: string): { x: number; y: number } => {
  const n = data.nodes.find((x) => x.id === id)!
  return { x: n.x, y: n.y }
}

describe('applyChanges', () => {
  it('adds boxes with my ids and arrows between them', () => {
    const result = applyChanges(EMPTY_CANVAS, CLASSES)
    expect(result.errors).toEqual([])
    expect(result.data.nodes.map((n) => n.id)).toEqual(['animal', 'dog', 'cat'])
    expect(result.data.edges[0]).toMatchObject({
      fromNode: 'dog',
      toNode: 'animal',
      relation: 'inheritance',
      toEnd: 'arrow'
    })
  })

  it('puts a parent class above its children, the children side by side', () => {
    const { data } = applyChanges(EMPTY_CANVAS, CLASSES)
    expect(at(data, 'animal').y).toBeLessThan(at(data, 'dog').y)
    expect(at(data, 'dog').y).toBe(at(data, 'cat').y)
    expect(at(data, 'dog').x).not.toBe(at(data, 'cat').x)
  })

  it('places new boxes right of what is there and keeps given positions', () => {
    const first = applyChanges(EMPTY_CANVAS, [{ op: 'add_box', id: 'a', text: 'A', x: 0, y: 0 }])
    const { data } = applyChanges(first.data, [
      { op: 'add_box', id: 'b', text: 'B' },
      { op: 'add_box', id: 'c', text: 'C', x: -500, y: 40 }
    ])
    expect(at(data, 'a')).toEqual({ x: 0, y: 0 })
    expect(at(data, 'b').x).toBeGreaterThan(100)
    expect(at(data, 'c')).toEqual({ x: -500, y: 40 })
  })

  it('gives a taken id a new one and still connects to it', () => {
    const first = applyChanges(EMPTY_CANVAS, [{ op: 'add_box', id: 'a', text: 'A', x: 0, y: 0 }])
    const result = applyChanges(first.data, [
      { op: 'add_box', id: 'a', text: 'Another A' },
      { op: 'add_arrow', from: 'a', to: 'a' }
    ])
    const fresh = result.added.get('a')!
    expect(fresh).not.toBe('a')
    expect(result.data.edges[0]).toMatchObject({ fromNode: fresh })
  })

  it('changes, recolours and deletes, and reports what it could not find', () => {
    const { data } = applyChanges(EMPTY_CANVAS, CLASSES)
    const arrow = data.edges[0].id
    const result = applyChanges(data, [
      { op: 'change_box', id: 'dog', text: 'Dog\n---\n+ bark()', color: '4' },
      { op: 'change_arrow', id: arrow, relation: 'realization', to_label: '1' },
      { op: 'delete', ids: ['cat'] },
      { op: 'change_box', id: 'horse', text: 'Horse' }
    ])
    expect(result.data.nodes.find((n) => n.id === 'dog')).toMatchObject({
      text: 'Dog\n---\n+ bark()',
      color: '4'
    })
    expect(result.data.edges.find((e) => e.id === arrow)).toMatchObject({
      relation: 'realization',
      toLabel: '1'
    })
    // The arrow from the deleted cat goes too.
    expect(result.data.edges).toHaveLength(1)
    expect(result.errors).toEqual([
      'change 4 (change_box): no box "horse"; use read_canvas for ids'
    ])
    expect(result.area).not.toBeNull()
  })

  it('clears a colour and a shape with an empty string', () => {
    const { data } = applyChanges(EMPTY_CANVAS, [
      { op: 'add_box', id: 'a', text: 'A', shape: 'ellipse', color: '2', x: 0, y: 0 }
    ])
    const { data: plain } = applyChanges(data, [
      { op: 'change_box', id: 'a', color: '', shape: '' }
    ])
    expect(plain.nodes[0]).not.toHaveProperty('color')
    expect(plain.nodes[0]).not.toHaveProperty('shape')
  })
})

describe('sizeFor', () => {
  it('fits a class to its longest line and its lines', () => {
    const size = sizeFor('Order\n---\n- placedOn: LocalDate\n---\n+ total(): Money', 'class')
    expect(size.width).toBeGreaterThan(180)
    expect(size.height).toBeGreaterThan(90)
    expect(sizeFor('', 'initial')).toEqual({ width: 30, height: 30 })
  })
})

describe('describeCanvas', () => {
  it('lists boxes with ids and text, then arrows', () => {
    const { data } = applyChanges(EMPTY_CANVAS, CLASSES)
    const text = describeCanvas('DSS/les_1/Animals.canvas', data)
    expect(text).toContain('Canvas DSS/les_1/Animals.canvas: 3 boxes, 2 arrows.')
    expect(text).toContain('- box dog (class) at x=')
    expect(text).toContain('    + speak()')
    expect(text).toContain(': dog -> animal (inheritance)')
  })
})
