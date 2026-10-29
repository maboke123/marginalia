import { useLayoutEffect, useRef, useState } from 'react'
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
  // The relation explained under the list: the one pointed at, else the current one.
  const [pointed, setPointed] = useState<{ kind: Relation | undefined } | null>(null)
  const [place, setPlace] = useState({ below: false, maxHeight: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const kinds: (Relation | undefined)[] = [undefined, ...RELATIONS]

  // Opens where the canvas has the most room, and scrolls when even that is too little.
  useLayoutEffect(() => {
    if (!open) return
    const button = buttonRef.current!.getBoundingClientRect()
    const host = buttonRef.current!.closest('.canvas-surface') ?? document.body
    const bounds = host.getBoundingClientRect()
    const above = button.top - bounds.top - 12
    const below = bounds.bottom - button.bottom - 12
    setPlace({ below: below > above, maxHeight: Math.max(above, below) })
    setPointed(null)
  }, [open])
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
        ref={buttonRef}
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
        <div
          className={place.below ? 'canvas-relation-menu below' : 'canvas-relation-menu'}
          style={{ maxHeight: place.maxHeight || undefined }}
        >
          <div className="canvas-relation-options" role="listbox" aria-label="Relation">
            {kinds.map((kind) => (
              <button
                key={kind ?? 'arrow'}
                role="option"
                aria-selected={kind === value}
                aria-description={relationMeaning(kind)}
                className={
                  kind === value ? 'canvas-relation-option pressed' : 'canvas-relation-option'
                }
                onPointerEnter={() => setPointed({ kind })}
                onFocus={() => setPointed({ kind })}
                onClick={() => {
                  onChange(kind)
                  setOpen(false)
                }}
              >
                <RelationPreview relation={kind} />
                <span>{relationLabel(kind)}</span>
              </button>
            ))}
          </div>
          <p className="canvas-relation-meaning" aria-live="polite">
            {relationMeaning(pointed ? pointed.kind : value)}
          </p>
        </div>
      )}
    </div>
  )
}
