import { describe, expect, it } from 'vitest'
import type { Stroke } from '../../../shared/annotations'
import { addItem, createAnnotationDoc, removeItems } from './doc'
import {
  distanceToSegment,
  erasedStrokes,
  hitsStroke,
  mergeLineRects,
  strokeBounds,
  sweep,
  translateStroke
} from './geometry'

const stroke = (id: string, points: [number, number][]): Stroke => ({
  id,
  tool: 'pen',
  color: '#1f6feb',
  width: 2,
  points: points.map(([x, y]) => [x, y, 0.5]),
  author: 'me'
})

describe('geometry', () => {
  it('measures the distance to a segment', () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3)
    expect(distanceToSegment([-4, 3], [0, 0], [10, 0])).toBe(5)
  })

  it('hits a stroke within its width plus tolerance', () => {
    const line = stroke('a', [
      [0, 0],
      [100, 0]
    ])
    expect(hitsStroke(line, [50, 3], 2)).toBe(true)
    expect(hitsStroke(line, [50, 4], 2)).toBe(false)
  })

  it('erases strokes crossed by a fast eraser movement', () => {
    const vertical = stroke('v', [
      [50, 0],
      [50, 100]
    ])
    const far = stroke('far', [
      [300, 0],
      [300, 100]
    ])
    const path = sweep([0, 50], [120, 50], 4)
    expect(erasedStrokes([vertical, far], path, 3)).toEqual(['v'])
  })

  it('moves and measures strokes', () => {
    const moved = translateStroke(
      stroke('a', [
        [10, 10],
        [20, 30]
      ]),
      5,
      -5
    )
    expect(moved.points).toEqual([
      [15, 5, 0.5],
      [25, 25, 0.5]
    ])
    expect(strokeBounds(moved)).toEqual([14, 4, 12, 22])
  })

  it('merges selection rectangles into one per line', () => {
    expect(
      mergeLineRects([
        [72, 140.5, 50, 14],
        [121, 141, 58.2, 13.5],
        [72, 160, 40, 14]
      ])
    ).toEqual([
      [72, 140.5, 107.2, 14],
      [72, 160, 40, 14]
    ])
  })
})

describe('annotation doc', () => {
  const a = stroke('a', [[1, 1]])
  const b = stroke('b', [[2, 2]])

  it('undoes and redoes changes one step at a time', () => {
    const doc = createAnnotationDoc({})
    doc.getState().change((p) => addItem(p, 3, 'strokes', a))
    doc.getState().change((p) => addItem(p, 3, 'strokes', b))

    doc.getState().undo()
    expect(doc.getState().pages['3'].strokes.map((s) => s.id)).toEqual(['a'])
    doc.getState().undo()
    expect(doc.getState().pages).toEqual({})
    doc.getState().redo()
    expect(doc.getState().pages['3'].strokes.map((s) => s.id)).toEqual(['a'])
  })

  it('turns a whole drag into one undo step', () => {
    const doc = createAnnotationDoc({ '1': { strokes: [a, b], highlights: [], textBoxes: [] } })
    doc.getState().begin()
    doc.getState().update((p) => removeItems(p, 1, 'strokes', ['a']))
    doc.getState().update((p) => removeItems(p, 1, 'strokes', ['b']))
    doc.getState().end()

    expect(doc.getState().pages).toEqual({})
    doc.getState().undo()
    expect(doc.getState().pages['1'].strokes).toHaveLength(2)
  })

  it('cancels without leaving an undo step', () => {
    const doc = createAnnotationDoc({})
    doc.getState().begin()
    doc.getState().update((p) => addItem(p, 1, 'strokes', a))
    doc.getState().cancel()

    expect(doc.getState().pages).toEqual({})
    expect(doc.getState().past).toEqual([])
  })

  it('drops the selection when undo removes the item', () => {
    const doc = createAnnotationDoc({})
    doc.getState().change((p) => addItem(p, 1, 'strokes', a))
    doc.getState().select({ page: 1, kind: 'strokes', id: 'a' })
    doc.getState().undo()

    expect(doc.getState().selection).toBeNull()
  })
})
