import { TEMPLATES, templateKind, type Template } from './shapes'

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

/**
 * The shapes in the toolbar's dropdown. Picking one arms it: the next click on the canvas puts
 * it there, a drag draws it at that size.
 */
export function ShapeMenu({
  active,
  onPick
}: {
  active: string | null
  onPick(template: Template): void
}): React.JSX.Element {
  return (
    <div className="canvas-shape-menu" role="group" aria-label="Shapes">
      {TEMPLATES.map((section) => (
        <section key={section.section}>
          <h3 className="menu-heading">{section.section}</h3>
          <div className="canvas-palette-grid">
            {section.items.map((t) => (
              <button
                key={t.name}
                className={
                  t.name === active ? 'canvas-palette-item pressed' : 'canvas-palette-item'
                }
                aria-pressed={t.name === active}
                title={t.hint ?? t.name}
                onClick={() => onPick(t)}
              >
                <Preview kind={templateKind(t)} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
