import { memo } from 'react'
import {
  cssColor,
  edgeStyle,
  sidePoint,
  type CanvasEdge,
  type Rect,
  type Side
} from '../../../shared/canvas'
import { edgeGeometry, freeEndSide, type EdgeGeometry } from './edges'

interface EdgeProps {
  edge: CanvasEdge
  geometry: EdgeGeometry
  selected: boolean
  proposal?: 'ghost' | 'removed'
}

const EdgeView = memo(function EdgeView({
  edge,
  geometry,
  selected,
  proposal
}: EdgeProps): React.JSX.Element {
  const color = cssColor(edge.color)
  const { dashed } = edgeStyle(edge)
  const className = ['canvas-edge', selected ? 'selected' : '', proposal ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <g className={className} style={color ? { color } : undefined} data-edge={edge.id}>
      <path className="canvas-edge-hit" d={geometry.path} />
      <path
        className="canvas-edge-line"
        d={geometry.path}
        strokeDasharray={dashed ? '8 6' : undefined}
      />
      {geometry.markers.map((m, i) => (
        <path key={i} className={`canvas-marker fill-${m.fill}`} d={m.d} />
      ))}
    </g>
  )
})

/** Labels are HTML on top of the lines, so they read like the rest of the text. */
export function EdgeLabels({
  edges,
  geometries
}: {
  edges: CanvasEdge[]
  geometries: Map<string, EdgeGeometry>
}): React.JSX.Element {
  return (
    <>
      {edges.flatMap((edge) => {
        const g = geometries.get(edge.id)
        if (!g) return []
        const labels: [string, { x: number; y: number }, string][] = []
        if (edge.label) labels.push(['label', g.middle, edge.label])
        if (edge.fromLabel) labels.push(['from', g.fromLabelAt, edge.fromLabel])
        if (edge.toLabel) labels.push(['to', g.toLabelAt, edge.toLabel])
        return labels.map(([kind, at, text]) => (
          <span
            key={`${edge.id}-${kind}`}
            className={`canvas-edge-label ${kind}`}
            style={{ left: at.x, top: at.y }}
            data-edge={edge.id}
          >
            {text}
          </span>
        ))
      })}
    </>
  )
}

export function CanvasEdges({
  edges,
  geometries,
  selected,
  proposals,
  draft,
  guides
}: {
  edges: CanvasEdge[]
  geometries: Map<string, EdgeGeometry>
  selected: Set<string>
  proposals: Map<string, 'ghost' | 'removed'>
  /** An arrow being dragged out of a box; it snaps to the side it would land on. */
  draft: {
    from: Rect
    fromSide: Side
    to: { x: number; y: number }
    land: { rect: Rect; side: Side } | null
  } | null
  guides: { x: number | null; y: number | null; view: Rect }
}): React.JSX.Element {
  let draftPath: string | null = null
  if (draft) {
    const end = draft.land?.rect ?? { ...draft.to, width: 0, height: 0 }
    draftPath = edgeGeometry(
      draft.from,
      draft.fromSide,
      end,
      draft.land?.side ?? freeEndSide(sidePoint(draft.from, draft.fromSide), draft.to),
      'none',
      'arrow'
    ).path
  }
  const { view } = guides
  return (
    <svg className="canvas-edges" aria-hidden>
      {edges.map((edge) => {
        const g = geometries.get(edge.id)
        return g ? (
          <EdgeView
            key={edge.id}
            edge={edge}
            geometry={g}
            selected={selected.has(edge.id)}
            proposal={proposals.get(edge.id)}
          />
        ) : null
      })}
      {draftPath && <path className="canvas-edge-line draft" d={draftPath} />}
      {guides.x !== null && (
        <line
          className="canvas-guide"
          x1={guides.x}
          x2={guides.x}
          y1={view.y}
          y2={view.y + view.height}
        />
      )}
      {guides.y !== null && (
        <line
          className="canvas-guide"
          y1={guides.y}
          y2={guides.y}
          x1={view.x}
          x2={view.x + view.width}
        />
      )}
    </svg>
  )
}
