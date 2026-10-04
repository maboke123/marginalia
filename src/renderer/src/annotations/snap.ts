/** Things a dragged text box or image can line up with, in page points. */
export interface SnapTargets {
  /** Vertical lines: slide and margin edges, other items' left and right sides. */
  edgesX: number[]
  /** Horizontal lines: page top and bottom, other items' top and bottom. */
  edgesY: number[]
  /** Where lines of slide text start. */
  textLefts: number[]
  /** Lines of slide text: their top and their vertical middle. */
  lineTops: number[]
  lineMiddles: number[]
}

/** A point on the dragged item (its distance from the item's left or top) and what it snaps to. */
export interface Anchor {
  offset: number
  targets: number[]
}

export interface AxisSnap {
  pos: number
  /** Where to draw the guide line, or null when nothing snapped. */
  guide: number | null
}

/** Shifts `pos` by the smallest amount that puts an anchor on a target within `threshold`. */
export function snapAxis(pos: number, anchors: Anchor[], threshold: number): AxisSnap {
  let best: { delta: number; guide: number } | null = null
  for (const anchor of anchors) {
    for (const target of anchor.targets) {
      const delta = target - (pos + anchor.offset)
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, guide: target }
      }
    }
  }
  return best ? { pos: pos + best.delta, guide: best.guide } : { pos, guide: null }
}

// Where the text inside a box starts, from .text-box in styles.css: 1px border, 3px 6px padding,
// line-height 1.35. The overlay works in page points, so these are points too.
const BOX_TEXT_LEFT = 7
const BOX_TEXT_TOP = 4
const LINE_HEIGHT = 1.35

/** Distance from a text box's top to the middle of its first line of text. */
export const firstLineMiddle = (fontSize: number): number =>
  BOX_TEXT_TOP + (fontSize * LINE_HEIGHT) / 2

/**
 * A text box snaps with its edges to edges, and with its first line of text to a line of slide
 * text (middles level, so different font sizes still sit on one line) and to where it starts.
 */
export function textBoxAnchors(
  targets: SnapTargets,
  box: { width: number; height: number; fontSize: number }
): { x: Anchor[]; y: Anchor[] } {
  return {
    x: [
      { offset: 0, targets: targets.edgesX },
      { offset: box.width, targets: targets.edgesX },
      { offset: BOX_TEXT_LEFT, targets: targets.textLefts }
    ],
    y: [
      { offset: 0, targets: targets.edgesY },
      { offset: box.height, targets: targets.edgesY },
      { offset: firstLineMiddle(box.fontSize), targets: targets.lineMiddles }
    ]
  }
}

/** An image snaps with its edges to edges, to where slide text starts and to tops of lines. */
export function imageAnchors(
  targets: SnapTargets,
  image: { width: number; height: number }
): { x: Anchor[]; y: Anchor[] } {
  const xs = [...targets.edgesX, ...targets.textLefts]
  return {
    x: [
      { offset: 0, targets: xs },
      { offset: image.width, targets: xs }
    ],
    y: [
      { offset: 0, targets: [...targets.edgesY, ...targets.lineTops] },
      { offset: image.height, targets: targets.edgesY }
    ]
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Lines of slide text from the boxes of its text runs: runs whose middles are close form one
 * line, which starts at its leftmost run.
 */
export function textLines(runs: Rect[]): { left: number; top: number; middle: number }[] {
  const lines: { left: number; top: number; middle: number; height: number }[] = []
  const sorted = runs
    .filter((r) => r.width > 0 && r.height > 0)
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
  for (const run of sorted) {
    const middle = run.y + run.height / 2
    const line = lines.find((l) => Math.abs(l.middle - middle) < Math.min(l.height, run.height) / 2)
    if (line) {
      line.left = Math.min(line.left, run.x)
      line.top = Math.min(line.top, run.y)
    } else {
      lines.push({ left: run.x, top: run.y, middle, height: run.height })
    }
  }
  return lines.map(({ left, top, middle }) => ({ left, top, middle }))
}
