import { describe, expect, it } from 'vitest'
import { imageAnchors, snapAxis, textBoxAnchors, textLines, type SnapTargets } from './snap'

const targets: SnapTargets = {
  edgesX: [0, 625, 1000],
  edgesY: [0, 469],
  textLefts: [60, 80],
  lineTops: [100, 130],
  lineMiddles: [108, 138]
}

describe('snapAxis', () => {
  it('moves to the nearest target within the threshold', () => {
    expect(snapAxis(57, [{ offset: 0, targets: [60, 80] }], 5)).toEqual({ pos: 60, guide: 60 })
    expect(snapAxis(50, [{ offset: 0, targets: [60, 80] }], 5)).toEqual({ pos: 50, guide: null })
  })

  it('picks whichever anchor is closest to a target', () => {
    // Left edge 3 from 625, right edge (offset 100) 1 from 1000: the right edge wins.
    const anchors = [
      { offset: 0, targets: [625] },
      { offset: 100, targets: [1000] }
    ]
    expect(snapAxis(899, anchors, 5)).toEqual({ pos: 900, guide: 1000 })
  })
})

describe('text boxes', () => {
  it('put their first line of text level with a line of slide text', () => {
    const { y } = textBoxAnchors(targets, { width: 200, height: 30, fontSize: 12 })
    // First line middle sits 4 + 12 * 1.35 / 2 = 12.1 below the top.
    const snapped = snapAxis(98, y, 5)
    expect(snapped.guide).toBe(108)
    expect(snapped.pos).toBeCloseTo(95.9)
  })

  it('start their text where the slide text starts', () => {
    const { x } = textBoxAnchors(targets, { width: 200, height: 30, fontSize: 12 })
    expect(snapAxis(51, x, 5)).toEqual({ pos: 53, guide: 60 })
  })

  it('line up with the margin edge', () => {
    const { x } = textBoxAnchors(targets, { width: 200, height: 30, fontSize: 12 })
    expect(snapAxis(628, x, 5)).toEqual({ pos: 625, guide: 625 })
  })
})

describe('images', () => {
  it('snap their top to the top of a slide text line', () => {
    const { y } = imageAnchors(targets, { width: 100, height: 50 })
    expect(snapAxis(127, y, 5)).toEqual({ pos: 130, guide: 130 })
  })
})

describe('textLines', () => {
  it('groups text runs on one line and starts it at the leftmost run', () => {
    const lines = textLines([
      { x: 120, y: 100, width: 50, height: 16 },
      { x: 60, y: 101, width: 40, height: 14 },
      { x: 80, y: 130, width: 200, height: 16 },
      { x: 10, y: 10, width: 0, height: 16 }
    ])
    expect(lines).toEqual([
      { left: 60, top: 100, middle: 108 },
      { left: 80, top: 130, middle: 138 }
    ])
  })
})
