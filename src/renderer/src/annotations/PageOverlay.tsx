import { memo, useCallback, useContext, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Stroke, TextBox } from '../../../shared/annotations'
import { useApp } from '../store'
import { AnnotationContext } from './context'
import {
  addItem,
  newId,
  pageOf,
  removeItems,
  replaceItem,
  updatePage,
  type AnnotationDoc,
  type Kind
} from './doc'
import {
  erasePartial,
  eraseWhole,
  hitsRects,
  round,
  strokeBounds,
  sweep,
  translateStroke,
  type Point
} from './geometry'
import { strokePath } from './ink'
import { HIGHLIGHT_OPACITY, HIGHLIGHTER_WIDTH, pageUnit, TEXT_SIZES } from './palette'
import { TextBoxView } from './TextBoxView'
import { TextLayerView } from './TextLayerView'

interface Props {
  pdf: PDFDocumentProxy
  number: number
  /** Page size in points, without the margin. */
  width: number
  height: number
  margin: number
  scale: number
}

/**
 * Everything drawn on top of one page, in page points: highlights, the PDF text layer,
 * ink and text boxes. One CSS transform scales it all to the current zoom.
 */
export const PageOverlay = memo(function PageOverlay(props: Props): React.JSX.Element {
  const doc = useContext(AnnotationContext)
  const { width, height, margin, scale } = props
  const style = {
    width: width * (1 + margin),
    height,
    transform: `scale(${scale})`
  }
  if (!doc) {
    return (
      <div className="page-overlay" style={style}>
        <TextLayerView pdf={props.pdf} number={props.number} width={width} height={height} />
      </div>
    )
  }
  return <AnnotatedOverlay {...props} doc={doc} style={style} />
})

/**
 * A text box being typed in saves when it loses focus. Blurring it first makes that save
 * happen before the next action starts, so their undo steps do not get mixed up.
 */
function finishTyping(): void {
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement && active.classList.contains('text-box-editor')) {
    active.blur()
  }
}

const DRAG_THRESHOLD_PX = 3
const DEFAULT_BOX_WIDTH = 180
// Boxes from before text sizes existed have no fontSize.
const DEFAULT_TEXT_SIZE = TEXT_SIZES[1].value

function AnnotatedOverlay({
  pdf,
  number,
  width,
  height,
  margin,
  scale,
  doc,
  style
}: Props & { doc: AnnotationDoc; style: React.CSSProperties }): React.JSX.Element {
  const tool = useApp((s) => s.tool)
  const ink = useApp((s) => s.ink)
  const page = useStore(doc, (s) => pageOf(s.pages, number))
  const selection = useStore(doc, (s) => (s.selection?.page === number ? s.selection : null))
  const editing = useStore(doc, (s) => (s.editing?.page === number ? s.editing : null))
  const rootRef = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<Stroke | null>(null)
  const [eraserAt, setEraserAt] = useState<Point | null>(null)
  const totalWidth = width * (1 + margin)
  const unit = pageUnit(width)

  const toPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = rootRef.current!.getBoundingClientRect()
      return [round((e.clientX - r.left) / scale), round((e.clientY - r.top) / scale)]
    },
    [scale]
  )

  // preventDefault on pointerdown also stops the focus change, so hand the keyboard to the viewer.
  const focusViewer = (): void =>
    rootRef.current?.closest<HTMLElement>('.pdf-scroll')?.focus({ preventScroll: true })

  /**
   * Moves something with the mouse as one undo step. `apply` gets the distance from the
   * starting point; a click without movement counts as no change.
   */
  function drag(
    e: React.PointerEvent,
    apply: (dx: number, dy: number) => void,
    onClick?: () => void
  ): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    finishTyping()
    focusViewer()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const start = toPoint(e)
    let moved = false
    doc.getState().begin()

    const onMove = (ev: PointerEvent): void => {
      const p = toPoint(ev)
      const dx = p[0] - start[0]
      const dy = p[1] - start[1]
      if (!moved && Math.hypot(dx, dy) * scale < DRAG_THRESHOLD_PX) return
      moved = true
      apply(round(dx), round(dy))
    }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      if (moved) {
        doc.getState().end()
      } else {
        doc.getState().cancel()
        onClick?.()
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  function select(kind: Kind, id: string): void {
    doc.getState().select({ page: number, kind, id })
  }

  function moveStroke(e: React.PointerEvent, stroke: Stroke): void {
    select('strokes', stroke.id)
    drag(e, (dx, dy) =>
      doc
        .getState()
        .update((p) => replaceItem(p, number, 'strokes', translateStroke(stroke, dx, dy)))
    )
  }

  function onBoxPointerDown(e: React.PointerEvent, box: TextBox): void {
    if (tool === 'text') {
      e.stopPropagation()
      startEditing(box)
      return
    }
    select('textBoxes', box.id)
    drag(e, (dx, dy) =>
      doc.getState().update((p) =>
        replaceItem(p, number, 'textBoxes', {
          ...box,
          x: round(box.x + dx),
          y: round(box.y + dy)
        })
      )
    )
  }

  function resizeBox(e: React.PointerEvent, box: TextBox): void {
    drag(e, (dx) =>
      doc.getState().update((p) =>
        replaceItem(p, number, 'textBoxes', {
          ...box,
          width: Math.max(40 * unit, round(box.width + dx))
        })
      )
    )
  }

  function startEditing(box: TextBox): void {
    finishTyping()
    doc.getState().begin()
    doc.getState().edit({ page: number, kind: 'textBoxes', id: box.id })
  }

  function commitBox(box: TextBox, markdown: string): void {
    const state = doc.getState()
    state.edit(null)
    if (markdown === box.markdown && box.markdown !== '') {
      state.cancel()
    } else if (markdown) {
      state.update((p) => replaceItem(p, number, 'textBoxes', { ...box, markdown }))
      state.end()
    } else if (box.markdown === '') {
      // A new box that stayed empty: as if it was never made.
      state.cancel()
    } else {
      state.update((p) => removeItems(p, number, 'textBoxes', [box.id]))
      state.end()
    }
    focusViewer()
  }

  function onCapturePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    finishTyping()
    focusViewer()
    const capture = e.currentTarget as HTMLElement
    capture.setPointerCapture(e.pointerId)
    const start = toPoint(e)
    doc.getState().select(null)

    if (tool === 'text') {
      const boxWidth = Math.max(
        60 * unit,
        Math.min(DEFAULT_BOX_WIDTH * unit, totalWidth - start[0] - 4 * unit)
      )
      const box: TextBox = {
        id: newId('t'),
        x: Math.min(start[0], totalWidth - boxWidth),
        y: start[1],
        width: boxWidth,
        fontSize: round(ink.textSize * unit),
        markdown: '',
        author: 'me'
      }
      doc.getState().begin()
      doc.getState().update((p) => addItem(p, number, 'textBoxes', box))
      doc.getState().edit({ page: number, kind: 'textBoxes', id: box.id })
      return
    }

    if (tool === 'eraser') {
      const radius = ink.eraserSize / scale
      let last = start
      const erase = (path: Point[]): void => {
        const current = pageOf(doc.getState().pages, number)
        const next =
          ink.eraserMode === 'stroke'
            ? eraseWhole(current, path, radius)
            : erasePartial(current, path, radius, () => newId('s'))
        if (next) doc.getState().update((p) => updatePage(p, number, () => next))
      }
      doc.getState().begin()
      erase([start])
      const onMove = (ev: PointerEvent): void => {
        const p = toPoint(ev)
        erase(sweep(last, p, radius / 2))
        last = p
      }
      const onUp = (): void => {
        capture.removeEventListener('pointermove', onMove)
        doc.getState().end()
      }
      capture.addEventListener('pointermove', onMove)
      capture.addEventListener('pointerup', onUp, { once: true })
      return
    }

    // Pen or highlighter.
    const pen = tool === 'pen'
    const base: Stroke = {
      id: newId('s'),
      tool: pen ? 'pen' : 'highlighter',
      color: pen ? ink.penColor : ink.highlightColor,
      width: round((pen ? ink.penWidth : HIGHLIGHTER_WIDTH) * unit),
      points: [[start[0], start[1], round(e.pressure || 0.5)]],
      author: 'me'
    }
    const points = base.points
    let frame = 0
    const onMove = (ev: PointerEvent): void => {
      // Coalesced events carry the points the browser merged between two frames.
      for (const c of ev.getCoalescedEvents?.() ?? [ev]) {
        const p = toPoint(c)
        points.push([p[0], p[1], round(c.pressure || 0.5)])
      }
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          setLive({ ...base, points: [...points] })
        })
      }
    }
    const onUp = (): void => {
      capture.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
      setLive(null)
      doc.getState().change((p) => addItem(p, number, 'strokes', { ...base, points: [...points] }))
    }
    setLive(base)
    capture.addEventListener('pointermove', onMove)
    capture.addEventListener('pointerup', onUp, { once: true })
  }

  // In select mode, a click that did not select any text may land on a highlight.
  function onPointerUp(e: React.PointerEvent): void {
    if (tool !== 'select' || e.button !== 0) return
    if (!(e.target as Element).closest('.textLayer')) return
    if (!window.getSelection()?.isCollapsed) return
    const p = toPoint(e)
    const hit = [...page.highlights].reverse().find((h) => hitsRects(h.rects, p))
    doc.getState().select(hit ? { page: number, kind: 'highlights', id: hit.id } : null)
  }

  const drawing = tool !== 'select'
  const highlighterStrokes = page.strokes.filter((s) => s.tool === 'highlighter')
  const penStrokes = page.strokes.filter((s) => s.tool === 'pen')
  const selectedStroke =
    selection?.kind === 'strokes' ? page.strokes.find((s) => s.id === selection.id) : undefined
  const hitWidth = 10 / scale

  return (
    <div
      ref={rootRef}
      className={`page-overlay tool-${tool}`}
      style={{ ...style, fontSize: DEFAULT_TEXT_SIZE * unit }}
      onPointerDown={() => {
        if (tool === 'select') doc.getState().select(null)
      }}
      onPointerUp={onPointerUp}
    >
      {page.highlights.map((h) =>
        h.rects.map(([x, y, w, rh], i) => (
          <div
            key={`${h.id}-${i}`}
            className={[
              'hl',
              h.style ?? 'highlight',
              selection?.kind === 'highlights' && selection.id === h.id ? 'selected' : ''
            ].join(' ')}
            data-author={h.author}
            style={{
              left: x,
              top: y,
              width: w,
              height: rh,
              color: h.color,
              // Line thickness for underline and strikethrough grows with the text.
              ['--line' as string]: `${Math.max(0.75, rh * 0.08)}px`
            }}
          />
        ))
      )}

      <TextLayerView pdf={pdf} number={number} width={width} height={height} />

      <svg className="ink" width={totalWidth} height={height}>
        <g className="highlighter" style={{ opacity: HIGHLIGHT_OPACITY }}>
          {highlighterStrokes.map((s) => (
            <path key={s.id} d={strokePath(s)} fill={s.color} />
          ))}
          {live?.tool === 'highlighter' && <path d={strokePath(live, true)} fill={live.color} />}
        </g>
        {penStrokes.map((s) => (
          <path key={s.id} d={strokePath(s)} fill={s.color} data-author={s.author} />
        ))}
        {live?.tool === 'pen' && <path d={strokePath(live, true)} fill={live.color} />}

        {!drawing &&
          page.strokes.map((s) => (
            <polyline
              key={`hit-${s.id}`}
              className="hit"
              points={s.points.map((p) => `${p[0]},${p[1]}`).join(' ')}
              strokeWidth={s.width + hitWidth}
              onPointerDown={(e) => moveStroke(e, s)}
            />
          ))}

        {selectedStroke && <SelectionBox stroke={selectedStroke} scale={scale} />}
        {tool === 'eraser' && eraserAt && (
          <circle className="eraser" cx={eraserAt[0]} cy={eraserAt[1]} r={ink.eraserSize / scale} />
        )}
      </svg>

      {drawing && (
        <div
          className="capture"
          onPointerDown={onCapturePointerDown}
          onPointerMove={tool === 'eraser' ? (e) => setEraserAt(toPoint(e)) : undefined}
          onPointerLeave={() => setEraserAt(null)}
        />
      )}

      {page.textBoxes.map((box) => (
        <TextBoxView
          key={box.id}
          box={box}
          selected={selection?.kind === 'textBoxes' && selection.id === box.id}
          editing={editing?.id === box.id}
          interactive={tool === 'select' || tool === 'text'}
          resizable={tool === 'select'}
          onPointerDown={(e) => onBoxPointerDown(e, box)}
          onDoubleClick={() => startEditing(box)}
          onResizeStart={(e) => resizeBox(e, box)}
          onCommit={(markdown) => commitBox(box, markdown)}
        />
      ))}
    </div>
  )
}

function SelectionBox({ stroke, scale }: { stroke: Stroke; scale: number }): React.JSX.Element {
  const [x, y, w, h] = strokeBounds(stroke)
  const pad = 4 / scale
  return (
    <rect
      className="selection-box"
      x={x - pad}
      y={y - pad}
      width={w + 2 * pad}
      height={h + 2 * pad}
      strokeWidth={1 / scale}
      strokeDasharray={`${4 / scale} ${3 / scale}`}
    />
  )
}
