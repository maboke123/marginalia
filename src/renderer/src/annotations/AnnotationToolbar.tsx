import { useStore } from 'zustand'
import { colorName, type AppSettings } from '../../../shared/settings'
import type { HotkeyAction } from '../../../shared/hotkeys'
import { Icon, type IconName } from '../components/Icon'
import { useApp, type Tool } from '../store'
import { findItem, replaceItem, type AnnotationDoc } from './doc'
import { round } from './geometry'
import { ERASER_SIZES, PEN_WIDTHS, pageUnit, TEXT_SIZES } from '../../../shared/palette'

const TOOLS: { tool: Tool; label: string; icon: IconName }[] = [
  { tool: 'select', label: 'Select', icon: 'cursor' },
  { tool: 'pen', label: 'Pen', icon: 'pen' },
  { tool: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
  { tool: 'eraser', label: 'Eraser', icon: 'eraser' },
  { tool: 'text', label: 'Text box', icon: 'text' }
]

const keyFor = (tool: Tool, settings: AppSettings): string =>
  tool === 'select' ? 'Esc' : settings.hotkeys[tool as HotkeyAction]

interface Props {
  doc: AnnotationDoc | null
  /** Width in points of a page, for sizes that scale with the page. */
  pageWidth(page: number): number
}

export function AnnotationToolbar({ doc, pageWidth }: Props): React.JSX.Element {
  const tool = useApp((s) => s.tool)
  const ink = useApp((s) => s.ink)
  const setTool = useApp((s) => s.setTool)
  const setInk = useApp((s) => s.setInk)
  const settings = useApp((s) => s.settings)

  return (
    <div className="annotation-toolbar" role="toolbar" aria-label="Annotation tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={tool === t.tool ? 'icon-button pressed' : 'icon-button'}
          title={`${t.label} (${keyFor(t.tool, settings)})`}
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
            colors={settings.penColors}
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
            colors={settings.highlightColors}
            value={ink.highlightColor}
            onPick={(highlightColor) => setInk({ highlightColor })}
          />
        </>
      )}

      {doc && tool === 'eraser' && (
        <>
          <span className="toolbar-divider" />
          <button
            className={ink.eraserMode === 'partial' ? 'text-button pressed' : 'text-button'}
            title="Erase only what is under the eraser"
            aria-pressed={ink.eraserMode === 'partial'}
            onClick={() => setInk({ eraserMode: 'partial' })}
          >
            Partial
          </button>
          <button
            className={ink.eraserMode === 'stroke' ? 'text-button pressed' : 'text-button'}
            title="Erase whole strokes and highlights"
            aria-pressed={ink.eraserMode === 'stroke'}
            onClick={() => setInk({ eraserMode: 'stroke' })}
          >
            Whole
          </button>
          {ERASER_SIZES.map((size) => (
            <button
              key={size.value}
              className={ink.eraserSize === size.value ? 'icon-button pressed' : 'icon-button'}
              title={`${size.name} eraser`}
              aria-label={`${size.name} eraser`}
              aria-pressed={ink.eraserSize === size.value}
              onClick={() => setInk({ eraserSize: size.value })}
            >
              <span className="eraser-size" style={{ width: size.value, height: size.value }} />
            </button>
          ))}
        </>
      )}
      {doc && <TextSizes doc={doc} pageWidth={pageWidth} />}

      {doc && (
        <>
          <span className="toolbar-divider" />
          <History doc={doc} />
        </>
      )}
    </div>
  )
}

/** Shown for the text tool and when a text box is selected; changes that box right away. */
function TextSizes({
  doc,
  pageWidth
}: {
  doc: AnnotationDoc
  pageWidth: Props['pageWidth']
}): React.JSX.Element | null {
  const tool = useApp((s) => s.tool)
  const textSize = useApp((s) => s.ink.textSize)
  const setInk = useApp((s) => s.setInk)
  const selection = useStore(doc, (s) => (s.selection?.kind === 'textBoxes' ? s.selection : null))
  if (tool !== 'text' && !selection) return null

  const box = selection && findItem(doc.getState().pages, { ...selection, kind: 'textBoxes' })
  const unit = selection ? pageUnit(pageWidth(selection.page)) : 1
  const current = box?.fontSize ? box.fontSize / unit : textSize

  function pick(size: number): void {
    setInk({ textSize: size })
    if (!selection || !box) return
    doc
      .getState()
      .change((p) =>
        replaceItem(p, selection.page, 'textBoxes', { ...box, fontSize: round(size * unit) })
      )
  }

  return (
    <>
      <span className="toolbar-divider" />
      {TEXT_SIZES.map((size) => (
        <button
          key={size.value}
          className={Math.abs(current - size.value) < 0.5 ? 'icon-button pressed' : 'icon-button'}
          title={`${size.name} text`}
          aria-label={`${size.name} text`}
          aria-pressed={Math.abs(current - size.value) < 0.5}
          onClick={() => pick(size.value)}
        >
          <span className="text-size" style={{ fontSize: size.value }}>
            A
          </span>
        </button>
      ))}
    </>
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
  colors: string[]
  value: string
  onPick(color: string): void
}): React.JSX.Element {
  return (
    <div className="ink-swatches">
      {colors.map((c, i) => (
        <button
          key={i}
          className="swatch"
          title={colorName(c)}
          aria-label={colorName(c)}
          aria-pressed={value === c}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )
}
