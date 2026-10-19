import { TEMPLATES, templateKind, type Template } from './shapes'

/** Shapes are dragged onto the canvas under this type, with the template's name. */
export const SHAPE_DRAG = 'application/x-marginalia-shape'

function Preview({ kind }: { kind: string }): React.JSX.Element {
  if (kind === 'actor') {
    return (
      <svg className="palette-shape p-actor" viewBox="0 0 20 26" aria-hidden>
        <circle cx="10" cy="5" r="3.5" />
        <path d="M10 8.5v9M3 12h14M10 17.5l-5 7M10 17.5l5 7" />
      </svg>
    )
  }
  if (kind === 'class') {
    return (
      <span className="palette-shape p-class" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    )
  }
  return <span className={`palette-shape p-${kind}`} aria-hidden />
}

/** The shapes to add, next to the canvas: click puts one in the middle, drag puts it where I drop. */
export function ShapePalette({ onAdd }: { onAdd(template: Template): void }): React.JSX.Element {
  return (
    <aside className="canvas-palette" aria-label="Shapes">
      <p className="muted canvas-palette-hint">Click to add, or drag onto the canvas</p>
      {TEMPLATES.map((section) => (
        <section key={section.section}>
          <h3 className="menu-heading">{section.section}</h3>
          <div className="canvas-palette-grid">
            {section.items.map((t) => (
              <button
                key={t.name}
                className="canvas-palette-item"
                title={t.hint ?? t.name}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(SHAPE_DRAG, t.name)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAdd(t)}
              >
                <Preview kind={templateKind(t)} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  )
}
