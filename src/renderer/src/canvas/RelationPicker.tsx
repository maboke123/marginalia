import { useState } from 'react'
import { edgeStyle, RELATIONS, type Relation } from '../../../shared/canvas'
import { Icon } from '../components/Icon'
import { edgeGeometry } from './edges'
import { relationLabel, relationMeaning } from './relations'

/** The arrow as the canvas draws it, small. */
export function RelationPreview({ relation }: { relation?: Relation }): React.JSX.Element {
  const style = edgeStyle({ id: '', fromNode: '', toNode: '', relation })
  const g = edgeGeometry(
    { x: 0, y: 2, width: 2, height: 20 },
    'right',
    { x: 98, y: 2, width: 2, height: 20 },
    'left',
    style.fromMarker,
    style.toMarker
  )
  return (
    <svg className="canvas-relation-preview" viewBox="0 0 100 24" aria-hidden>
      <path
        className="canvas-edge-line"
        d={g.path}
        strokeDasharray={style.dashed ? '8 6' : undefined}
      />
      {g.markers.map((m, i) => (
        <path key={i} className={`canvas-marker fill-${m.fill}`} d={m.d} />
      ))}
    </svg>
  )
}

/** Picks a relation from a list that shows each arrow and what it means. */
export function RelationPicker({
  value,
  onChange
}: {
  value: Relation | undefined
  onChange(relation: Relation | undefined): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const kinds: (Relation | undefined)[] = [undefined, ...RELATIONS]
  return (
    <div
      className="canvas-relation"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') setOpen(false)
      }}
    >
      <button
        className="canvas-relation-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Relation: ${relationLabel(value)}`}
        onClick={() => setOpen(!open)}
      >
        <RelationPreview relation={value} />
        <span>{relationLabel(value)}</span>
        <Icon name="down" />
      </button>
      {open && (
        <div className="canvas-relation-menu" role="listbox" aria-label="Relation">
          {kinds.map((kind) => (
            <button
              key={kind ?? 'arrow'}
              role="option"
              aria-selected={kind === value}
              className={
                kind === value ? 'canvas-relation-option pressed' : 'canvas-relation-option'
              }
              onClick={() => {
                onChange(kind)
                setOpen(false)
              }}
            >
              <RelationPreview relation={kind} />
              <span>
                <strong>{relationLabel(kind)}</strong>
                <span className="muted">{relationMeaning(kind)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
