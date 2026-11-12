import { newCanvasId, type CanvasNode, type Shape } from '../../../shared/canvas'

export interface Template {
  name: string
  /** Shown under the name in the shapes menu. */
  hint?: string
  make(x: number, y: number): CanvasNode
}

const text =
  (shape: Shape, body: string, width: number, height: number) =>
  (x: number, y: number): CanvasNode => ({
    id: newCanvasId(),
    type: 'text',
    shape,
    text: body,
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height
  })

const group =
  (label: string, width: number, height: number) =>
  (x: number, y: number): CanvasNode => ({
    id: newCanvasId(),
    type: 'group',
    label,
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height
  })

/** What the shapes menu adds, in UML groups, centred on the point given. */
export const TEMPLATES: { section: string; items: Template[] }[] = [
  {
    section: 'Basic',
    items: [
      { name: 'Text box', make: text('rectangle', '', 240, 80) },
      { name: 'Rounded box', make: text('rounded', '', 200, 70) },
      { name: 'Ellipse', make: text('ellipse', '', 200, 100) },
      { name: 'Circle', make: text('circle', '', 100, 100) },
      { name: 'Note', make: text('note', 'Note', 180, 100) },
      { name: 'Group', make: group('Group', 480, 320) }
    ]
  },
  {
    section: 'Class diagram',
    items: [
      {
        name: 'Class',
        hint: 'First line the name, then a line with --- before the attributes and another before the operations',
        make: text('class', 'ClassName\n---\n- attribute: Type\n---\n+ operation(): Type', 240, 150)
      },
      {
        name: 'Interface',
        make: text('class', '«interface»\nName\n---\n+ operation(): Type', 240, 120)
      },
      { name: 'Enum', make: text('class', '«enumeration»\nName\n---\nVALUE_A\nVALUE_B', 200, 130) },
      { name: 'Package', make: group('package', 480, 320) }
    ]
  },
  {
    section: 'Use case diagram',
    items: [
      { name: 'Actor', make: text('actor', 'Actor', 90, 130) },
      { name: 'Use case', make: text('ellipse', 'Use case', 200, 90) },
      { name: 'System boundary', make: group('System', 520, 420) }
    ]
  },
  {
    section: 'State and activity',
    items: [
      { name: 'State', make: text('rounded', 'State', 170, 70) },
      { name: 'Action', make: text('rounded', 'Action', 190, 60) },
      { name: 'Decision', make: text('diamond', '', 70, 70) },
      { name: 'Start', make: text('initial', '', 30, 30) },
      { name: 'End', make: text('final', '', 34, 34) }
    ]
  },
  {
    section: 'Sequence diagram',
    items: [
      {
        name: 'Lifeline',
        hint: 'Drag an arrow from a bar onto it for a call',
        make: text('lifeline', 'obj: Class', 200, 460)
      },
      { name: 'Activation bar', make: text('activation', '', 16, 80) },
      {
        name: 'Fragment',
        hint: 'loop, alt, opt: the first line goes in the corner',
        make: text('fragment', 'loop [for each item]', 420, 240)
      }
    ]
  }
]

/** How a template looks in the palette: its shape, or "group". */
export function templateKind(t: Template): string {
  const node = t.make(0, 0)
  return node.type === 'group'
    ? 'group'
    : node.type === 'text'
      ? (node.shape ?? 'rectangle')
      : node.type
}

export const templateByName = (name: string): Template | undefined =>
  TEMPLATES.flatMap((s) => s.items).find((t) => t.name === name)

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * How big a shape added with a click comes out: at least normal size on screen, so one added
 * while zoomed out is not tiny (up to 4 times the normal size).
 */
export const clickScale = (zoom: number): number => round2(Math.min(4, Math.max(1, 1 / zoom)))

/**
 * A template made at a scale: the box and its text grow together (`fontScale`). With `rect`
 * (a shape dragged out) the scale follows the drawn size and the box takes that rectangle;
 * start and end dots stay round.
 */
export function makeScaled(
  t: Template,
  at: { x: number; y: number },
  scale: number,
  rect?: { x: number; y: number; width: number; height: number }
): CanvasNode {
  const base = t.make(at.x, at.y)
  const marker = base.type === 'text' && (base.shape === 'initial' || base.shape === 'final')
  let s = scale
  if (rect) s = Math.min(rect.width / base.width, rect.height / base.height)
  s = round2(Math.min(6, Math.max(0.5, s)))
  let box = rect ?? {
    x: Math.round(at.x - (base.width * s) / 2),
    y: Math.round(at.y - (base.height * s) / 2),
    width: Math.round(base.width * s),
    height: Math.round(base.height * s)
  }
  if (marker) {
    const side = Math.round(base.width * s)
    box = {
      x: Math.round(box.x + box.width / 2 - side / 2),
      y: Math.round(box.y + box.height / 2 - side / 2),
      width: side,
      height: side
    }
  }
  const node = { ...base, ...box } as CanvasNode
  return s === 1 || marker ? node : ({ ...node, fontScale: s } as CanvasNode)
}
