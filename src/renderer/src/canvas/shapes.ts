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
        hint: 'Name, attributes, operations',
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

/** What typing in a box means, shown above it while I edit. */
export function editHint(shape: string | undefined): string {
  if (shape === 'class') {
    return 'First line: the name («interface» above it if needed). A line with --- starts the attributes, the next --- the operations. Esc when done.'
  }
  return 'Markdown and $math$ work. Esc or Ctrl+Enter when done.'
}
