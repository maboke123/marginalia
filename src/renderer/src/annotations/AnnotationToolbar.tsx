import { useStore } from 'zustand'
import { Icon, type IconName } from '../components/Icon'
import { useApp, type Tool } from '../store'
import type { AnnotationDoc } from './doc'
import { HIGHLIGHT_COLORS, PEN_COLORS, PEN_WIDTHS } from './palette'

const TOOLS: { tool: Tool; label: string; key: string; icon: IconName }[] = [
  { tool: 'select', label: 'Select', key: 'Esc', icon: 'cursor' },
  { tool: 'pen', label: 'Pen', key: 'P', icon: 'pen' },
  { tool: 'highlighter', label: 'Highlighter', key: 'H', icon: 'highlighter' },
  { tool: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { tool: 'text', label: 'Text box', key: 'T', icon: 'text' }
]

export function AnnotationToolbar({ doc }: { doc: AnnotationDoc | null }): React.JSX.Element {
  const tool = useApp((s) => s.tool)
  const ink = useApp((s) => s.ink)
  const setTool = useApp((s) => s.setTool)
  const setInk = useApp((s) => s.setInk)

  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={tool === t.tool ? 'icon-button pressed' : 'icon-button'}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.tool}
          disabled={!doc && t.tool !== 'select'}
          onClick={() => setTool(t.tool)}
        >
          <Icon name={t.icon} />
        </button>
      ))}

      {doc && tool === 'pen' && (
        <>
          <span className="toolbar-divider" />
          <Swatches
            colors={PEN_COLORS}
            value={ink.penColor}
            onPick={(penColor) => setInk({ penColor })}
          />
          {PEN_WIDTHS.map((w) => (
            <button
              key={w.value}
              className={ink.penWidth === w.value ? 'icon-button pressed' : 'icon-button'}
              title={w.name}
              aria-label={`${w.name} pen`}
              aria-pressed={ink.penWidth === w.value}
              onClick={() => setInk({ penWidth: w.value })}
            >
              <span className="pen-width" style={{ height: w.value + 0.5 }} />
            </button>
          ))}
        </>
      )}
      {doc && tool === 'highlighter' && (
        <>
          <span className="toolbar-divider" />
          <Swatches
            colors={HIGHLIGHT_COLORS}
            value={ink.highlightColor}
            onPick={(highlightColor) => setInk({ highlightColor })}
          />
        </>
      )}

      {doc && (
        <>
          <span className="toolbar-divider" />
          <History doc={doc} />
        </>
      )}
    </div>
  )
}

function History({ doc }: { doc: AnnotationDoc }): React.JSX.Element {
  const canUndo = useStore(doc, (s) => s.past.length > 0)
  const canRedo = useStore(doc, (s) => s.future.length > 0)
  return (
    <>
      <button
        className="icon-button"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => doc.getState().undo()}
      >
        <Icon name="undo" />
      </button>
      <button
        className="icon-button"
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => doc.getState().redo()}
      >
        <Icon name="redo" />
      </button>
    </>
  )
}

function Swatches({
  colors,
  value,
  onPick
}: {
  colors: { name: string; value: string }[]
  value: string
  onPick(color: string): void
}): React.JSX.Element {
  return (
    <div className="ink-swatches">
      {colors.map((c) => (
        <button
          key={c.value}
          className="swatch"
          title={c.name}
          aria-label={c.name}
          aria-pressed={value === c.value}
          style={{ background: c.value }}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  )
}
