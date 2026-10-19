import type { CanvasData, Rect } from '../../../shared/canvas'
import { CanvasEdges, EdgeLabels } from './CanvasEdges'
import { CanvasNodeView } from './CanvasNodeView'
import { edgePorts, geometryOf, type EdgeGeometry } from './edges'
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
  const geometries = new Map<string, EdgeGeometry>()
  const ports = edgePorts(data.edges, byId)
  for (const edge of data.edges) {
    const g = geometryOf(edge, byId, ports)
    if (g) geometries.set(edge.id, g)
  }
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
