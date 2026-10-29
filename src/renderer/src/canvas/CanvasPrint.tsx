import type { CanvasData, Rect } from '../../../shared/canvas'
import { CanvasEdges, EdgeLabels } from './CanvasEdges'
import { CanvasNodeView } from './CanvasNodeView'
import { edgeGeometries } from './edges'
import { drawOrder } from './ops'

const NOOP = (): void => {}

/** All of a canvas, drawn once without handles, for printing. */
export function CanvasPrint({
  data,
  bounds,
  margin,
  scale
}: {
  data: CanvasData
  bounds: Rect
  margin: number
  scale: number
}): React.JSX.Element {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const geometries = edgeGeometries(data.edges, byId)
  const ordered = drawOrder(data.nodes)
  const node = (n: (typeof data.nodes)[number]): React.JSX.Element => (
    <CanvasNodeView
      key={n.id}
      node={n}
      selected={false}
      handles={false}
      editing={false}
      onText={NOOP}
      onDone={NOOP}
    />
  )
  return (
    <div
      className="canvas-world"
      style={{
        transform: `scale(${scale}) translate(${margin - bounds.x}px, ${margin - bounds.y}px)`
      }}
    >
      {ordered.filter((n) => n.type === 'group').map(node)}
      <CanvasEdges
        edges={data.edges.filter((e) => geometries.has(e.id))}
        geometries={geometries}
        selected={new Set()}
        proposals={new Map()}
        draft={null}
        guides={{ x: null, y: null, view: bounds }}
      />
      {ordered.filter((n) => n.type !== 'group').map(node)}
      <EdgeLabels edges={data.edges} geometries={geometries} />
    </div>
  )
}
