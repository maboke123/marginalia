import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AnnotationPages, PageImage, Stroke, TextBox } from '../../../shared/annotations'
import { vaultUrl } from '../editor/links'
import { useApp } from '../store'
import { addImageFiles, rememberClick } from './addImages'
import { AnnotationContext } from './context'
import {
  addItem,
  findItem,
  moveToPage,
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
import { applyChanges, planWrite, type WriteAnswer } from '../claude/writePlan'
import { openPdf } from '../lib/open'
import { useFind, type FindHit } from '../pdf/find'
import { FindHits } from '../pdf/FindBar'
import { placeFitted, planBox, type FitPage } from './fit'
import { GhostView } from './GhostView'
import { ImageView } from './ImageView'
import { imagePath, resizeImage } from './images'
import {
  firstLineMiddle,
  imageAnchors,
  snapAxis,
  textBoxAnchors,
  textLines,
  type Anchor,
  type Rect,
  type SnapTargets
} from './snap'
import { strokePath } from './ink'
import {
  HIGHLIGHT_OPACITY,
  HIGHLIGHTER_WIDTH,
  pageUnit,
  DEFAULT_TEXT_SIZE
} from '../../../shared/palette'
import { TextBoxView } from './TextBoxView'
import { TextLayerView } from './TextLayerView'

interface Props {
  pdf: PDFDocumentProxy
  /** Vault path of the PDF; images on its pages are stored next to it. */
  path: string
  number: number
  /** A blank page I added: no PDF text to select. */
  blank?: boolean
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
        <FindHits path={props.path} number={props.number} />
        {!props.blank && (
          <TextLayerView pdf={props.pdf} number={props.number} width={width} height={height} />
        )}
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
// How close, in screen pixels, something has to come to snap.
const SNAP_PX = 6
// How close to the top or bottom of the view, in screen pixels, a drag starts scrolling.
const SCROLL_EDGE_PX = 40

/** The page under the mouse, with where it is on screen. */
function pageAt(
  scroller: HTMLElement,
  ev: { clientX: number; clientY: number }
): { page: number; rect: DOMRect } | null {
  for (const el of scroller.querySelectorAll<HTMLElement>('.pdf-page[data-page]')) {
    const rect = el.getBoundingClientRect()
    if (
      ev.clientX >= rect.left &&
      ev.clientX <= rect.right &&
      ev.clientY >= rect.top &&
      ev.clientY <= rect.bottom
    ) {
      return { page: Number(el.dataset.page), rect }
    }
  }
  return null
}

interface Guides {
  x: number | null
  y: number | null
}
const NO_GUIDES: Guides = { x: null, y: null }
const NO_HITS: FindHit[] = []
const DEFAULT_BOX_WIDTH = 180

function AnnotatedOverlay({
  pdf,
  path,
  number,
  blank,
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
  const ghost = useStore(doc, (s) => (s.ghost?.page === number ? s.ghost : null))
  const found = useFind((s) => (s.path === path ? s.hits : NO_HITS))
  const currentHit = useFind((s) => (s.path === path ? s.hits[s.current] : undefined))
  const rootRef = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<Stroke | null>(null)
  const [eraserAt, setEraserAt] = useState<Point | null>(null)
  const totalWidth = width * (1 + margin)
  const unit = pageUnit(width)
  const snapping = useApp((s) => s.settings.snapping)
  const [guides, setGuides] = useState<Guides>(NO_GUIDES)

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
   * starting point; a click without movement counts as no change. Near the top or bottom of
   * the view it scrolls along, and with `moveTo` an item let go over another page goes there.
   */
  function drag(
    e: React.PointerEvent,
    apply: (dx: number, dy: number, ev: PointerEvent) => void,
    moveTo?: (page: number, dx: number, dy: number) => void
  ): void {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    finishTyping()
    focusViewer()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const scroller = rootRef.current!.closest<HTMLElement>('.pdf-scroll')!
    // The page element stays when its overlay is unmounted after scrolling far away.
    const ownPage = rootRef.current!.closest<HTMLElement>('.pdf-page')!
    // Measured on screen, not on the page: selecting can change the toolbar's height and move
    // the page under the mouse, and the item should still follow the mouse.
    const start = [e.clientX + scroller.scrollLeft, e.clientY + scroller.scrollTop]
    let moved = false
    let last: PointerEvent | null = null
    let frame = 0
    doc.getState().begin()
    // Otherwise the next page is drawn over an item dragged onto it.
    ownPage.classList.add('lifted')

    const follow = (ev: PointerEvent): void => {
      const dx = (ev.clientX + scroller.scrollLeft - start[0]) / scale
      const dy = (ev.clientY + scroller.scrollTop - start[1]) / scale
      if (!moved && Math.hypot(dx, dy) * scale < DRAG_THRESHOLD_PX) return
      moved = true
      apply(round(dx), round(dy), ev)
    }
    const autoscroll = (): void => {
      frame = 0
      if (!last || !moved) return
      const view = scroller.getBoundingClientRect()
      const below = last.clientY - (view.bottom - SCROLL_EDGE_PX)
      const above = view.top + SCROLL_EDGE_PX - last.clientY
      const speed = below > 0 ? below : above > 0 ? -above : 0
      if (!speed) return
      const clamped = Math.max(-SCROLL_EDGE_PX, Math.min(SCROLL_EDGE_PX, speed)) / 2
      scroller.scrollTop += clamped
      follow(last)
      frame = requestAnimationFrame(autoscroll)
    }
    const onMove = (ev: PointerEvent): void => {
      last = ev
      follow(ev)
      if (!frame) frame = requestAnimationFrame(autoscroll)
    }
    // On the window, so the drag still ends when the page scrolled out of view meanwhile.
    const onUp = (ev: PointerEvent): void => {
      cancelAnimationFrame(frame)
      ownPage.classList.remove('lifted')
      setGuides(NO_GUIDES)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) {
        doc.getState().cancel()
        return
      }
      const to = moveTo && pageAt(scroller, ev)
      if (to && to.page !== number) {
        const from = ownPage.getBoundingClientRect()
        moveTo(to.page, (from.left - to.rect.left) / scale, (from.top - to.rect.top) / scale)
      }
      doc.getState().end()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /** Puts a dragged item on another page, at the same spot on screen. */
  function moveItem(kind: 'strokes' | 'textBoxes' | 'images', id: string) {
    return (to: number, dx: number, dy: number): void => {
      doc
        .getState()
        .update((p) =>
          moveToPage(p, { page: number, kind, id }, to, (item) =>
            'points' in item
              ? translateStroke(item, dx, dy)
              : { ...item, x: round(item.x + dx), y: round(item.y + dy) }
          )
        )
      doc.getState().select({ page: to, kind, id })
    }
  }

  /**
   * What an item can line up with on this page, measured from the page as drawn: slide and
   * margin edges, the other boxes and images, and the lines of slide text.
   */
  function snapTargets(exclude: string): SnapTargets {
    const root = rootRef.current!
    const origin = root.getBoundingClientRect()
    const local = (b: DOMRect): Rect => ({
      x: (b.left - origin.left) / scale,
      y: (b.top - origin.top) / scale,
      width: b.width / scale,
      height: b.height / scale
    })
    const items = [
      ...root.querySelectorAll<HTMLElement>('.text-box[data-id], .page-image[data-id]')
    ]
      .filter((el) => el.dataset.id !== exclude)
      .map((el) => local(el.getBoundingClientRect()))
    const lines = textLines(
      [...root.querySelectorAll('.textLayer span')].map((el) => local(el.getBoundingClientRect()))
    )
    return {
      edgesX: [0, width, totalWidth, ...items.flatMap((i) => [i.x, i.x + i.width])],
      edgesY: [0, height, ...items.flatMap((i) => [i.y, i.y + i.height])],
      textLefts: lines.map((l) => l.left),
      lineTops: lines.map((l) => l.top),
      lineMiddles: lines.map((l) => l.middle)
    }
  }

  /** Snaps a position unless snapping is off or Alt is held; shows what it snapped to. */
  function snapTo(
    ev: { altKey: boolean; clientX: number; clientY: number },
    x: number,
    y: number,
    anchors: { x: Anchor[]; y: Anchor[] }
  ): [number, number] {
    if (!snapping || ev.altKey || !overThisPage(ev)) {
      setGuides(NO_GUIDES)
      return [x, y]
    }
    const threshold = SNAP_PX / scale
    const sx = snapAxis(x, anchors.x, threshold)
    const sy = snapAxis(y, anchors.y, threshold)
    setGuides({ x: sx.guide, y: sy.guide })
    return [round(sx.pos), round(sy.pos)]
  }

  function overThisPage(ev: { clientX: number; clientY: number }): boolean {
    const page = rootRef.current?.closest('.pdf-page')
    if (!page) return false
    const r = page.getBoundingClientRect()
    return (
      ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
    )
  }

  function select(kind: Kind, id: string): void {
    doc.getState().select({ page: number, kind, id })
  }

  function moveStroke(e: React.PointerEvent, stroke: Stroke): void {
    select('strokes', stroke.id)
    drag(
      e,
      (dx, dy) =>
        doc
          .getState()
          .update((p) => replaceItem(p, number, 'strokes', translateStroke(stroke, dx, dy))),
      moveItem('strokes', stroke.id)
    )
  }

  function onBoxPointerDown(e: React.PointerEvent, box: TextBox): void {
    if (tool === 'text') {
      if (e.button !== 0) return
      e.stopPropagation()
      // Otherwise the mouse-down moves focus to the viewer right after the editor took it,
      // and losing focus closes the box again.
      e.preventDefault()
      startEditing(box)
      return
    }
    select('textBoxes', box.id)
    const anchors = textBoxAnchors(snapTargets(box.id), {
      width: box.width,
      height: (e.currentTarget as HTMLElement).offsetHeight,
      fontSize: box.fontSize ?? DEFAULT_TEXT_SIZE * unit
    })
    drag(
      e,
      (dx, dy, ev) => {
        const [x, y] = snapTo(ev, box.x + dx, box.y + dy, anchors)
        doc.getState().update((p) => replaceItem(p, number, 'textBoxes', { ...box, x, y }))
      },
      moveItem('textBoxes', box.id)
    )
  }

  function resizeBox(e: React.PointerEvent, box: TextBox): void {
    const edges = snapTargets(box.id).edgesX
    drag(e, (dx, _dy, ev) => {
      const [right] = snapTo(ev, box.x + box.width + dx, 0, {
        x: [{ offset: 0, targets: edges }],
        y: []
      })
      doc.getState().update((p) =>
        replaceItem(p, number, 'textBoxes', {
          ...box,
          width: Math.max(40 * unit, round(right - box.x))
        })
      )
    })
  }

  function moveImage(e: React.PointerEvent, image: PageImage): void {
    select('images', image.id)
    const anchors = imageAnchors(snapTargets(image.id), image)
    drag(
      e,
      (dx, dy, ev) => {
        const [x, y] = snapTo(ev, image.x + dx, image.y + dy, anchors)
        doc.getState().update((p) => replaceItem(p, number, 'images', { ...image, x, y }))
      },
      moveItem('images', image.id)
    )
  }

  function resizeImageBy(e: React.PointerEvent, image: PageImage): void {
    select('images', image.id)
    const edges = snapTargets(image.id).edgesX
    drag(e, (dx, _dy, ev) => {
      const right = image.x + image.width + dx
      const [snapped] = snapTo(ev, right, 0, { x: [{ offset: 0, targets: edges }], y: [] })
      const next = resizeImage(image, snapped - image.x - image.width, 20 * unit)
      doc.getState().update((p) => replaceItem(p, number, 'images', next))
    })
  }

  // Images dropped from Explorer land where they are dropped. preventDefault tells the
  // workspace, which would otherwise try to import them as PDFs, that they were taken care of.
  function onDrop(e: React.DragEvent): void {
    const files = [...e.dataTransfer.files]
    if (!files.length || !files.every((f) => f.type.startsWith('image/'))) return
    e.preventDefault()
    addImageFiles(doc, path, files, { page: number, width, height, margin, at: toPoint(e) })
  }

  function startEditing(box: TextBox): void {
    finishTyping()
    doc.getState().begin()
    doc.getState().edit({ page: number, kind: 'textBoxes', id: box.id })
  }

  const fitPage = useMemo<FitPage>(
    () => ({ width: totalWidth, height, gap: 8 * unit }),
    [totalWidth, height, unit]
  )

  /**
   * After Claude wrote in a box: as wide as it needs to end above the page bottom, moved up, or
   * on a new blank page below at full width when it is too long for that.
   */
  function fitted(pages: AnnotationPages, box: TextBox): AnnotationPages {
    const plan = planBox(pages, number, box, fitPage, DEFAULT_TEXT_SIZE * unit)
    // Already on a blank page, where a next one has no more room: at the top, full width.
    if (plan.kind === 'blank' && blank) {
      const top = { kind: 'fits' as const, width: plan.width, y: plan.y }
      return placeFitted(pages, number, { ...box, x: plan.x }, top, fitPage)
    }
    return placeFitted(pages, number, box, plan, fitPage)
  }

  // Claude's boxes as read from disk (the terminal can write the annotation file) get the
  // same fit, once, when the page shows them. Boxes changed since loading are left alone.
  const checked = useRef(new Set<TextBox>())
  useEffect(() => {
    const { loaded, pages } = doc.getState()
    const fromDisk = new Set(pageOf(loaded, number).textBoxes)
    for (const box of page.textBoxes) {
      if (box.author !== 'claude' || !fromDisk.has(box) || checked.current.has(box)) continue
      checked.current.add(box)
      const plan = planBox(pages, number, box, fitPage, DEFAULT_TEXT_SIZE * unit)
      if (plan.kind === 'fits' && plan.width === box.width && plan.y === box.y) continue
      if (plan.kind === 'blank' && blank) continue
      doc
        .getState()
        .change((p) =>
          findItem(p, { page: number, kind: 'textBoxes', id: box.id }) === box ? fitted(p, box) : p
        )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.textBoxes, fitPage])

  function commitBox(box: TextBox, markdown: string, claudeWrote: boolean): void {
    const state = doc.getState()
    state.edit(null)
    if (markdown === box.markdown && box.markdown !== '') {
      state.cancel()
    } else if (markdown) {
      const next = { ...box, markdown }
      state.update((p) => {
        const replaced = replaceItem(p, number, 'textBoxes', next)
        return claudeWrote ? fitted(replaced, next) : replaced
      })
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

  /**
   * A /claude answer for a box I already closed: put it in as its own undo step. When the
   * slides were closed in the meantime it goes straight into the annotation file.
   */
  function lateAnswer(id: string, original: string, answer: WriteAnswer): void {
    const apply = (pages: AnnotationPages): AnnotationPages | null => {
      const current = findItem(pages, { page: number, kind: 'textBoxes', id })
      const at = current?.markdown.indexOf(original) ?? -1
      if (!current || at === -1) return null
      const request = { from: at, to: at + original.length }
      const { changes } = planWrite(current.markdown, request, answer)
      const next = { ...current, markdown: applyChanges(current.markdown, changes).trim() }
      return fitted(replaceItem(pages, number, 'textBoxes', next), next)
    }
    const changed = (): void =>
      useApp.getState().showError('The /claude request was changed; nothing was inserted')

    if (openPdf(path)?.doc === doc) {
      const next = apply(doc.getState().pages)
      if (next) doc.getState().change((p) => apply(p) ?? p)
      else changed()
      return
    }
    window.api.vault
      .readAnnotations(path)
      .then(async ({ file }) => {
        const next = file && apply(file.pages)
        if (!file || !next) return changed()
        await window.api.vault.writeAnnotations(path, { ...file, pages: next })
      })
      .catch((err: Error) =>
        useApp.getState().showError(`Claude's answer was not saved: ${err.message}`)
      )
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
      const fontSize = round(ink.textSize * unit)
      // The first line of text goes where I click (not the box's edge), then snaps to the
      // slide line it was put next to, like a moved box.
      const anchors = textBoxAnchors(snapTargets(''), {
        width: boxWidth,
        height: fontSize * 1.35 + 8,
        fontSize
      })
      const top = Math.max(0, start[1] - firstLineMiddle(fontSize))
      const [x, y] = snapTo(e, Math.min(start[0], totalWidth - boxWidth), top, anchors)
      setGuides(NO_GUIDES)
      const box: TextBox = {
        id: newId('t'),
        x,
        y,
        width: boxWidth,
        fontSize,
        ...(ink.textColor && { color: ink.textColor }),
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
  const hits = found.filter((h) => h.page === number)
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
      onPointerDownCapture={(e) => rememberClick(doc, number, toPoint(e))}
      onPointerDown={() => {
        if (tool === 'select') doc.getState().select(null)
      }}
      onPointerUp={onPointerUp}
      onDrop={onDrop}
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

      <FindHits path={path} number={number} />

      {!blank && <TextLayerView pdf={pdf} number={number} width={width} height={height} />}

      {page.images?.map((image) => (
        <ImageView
          key={image.id}
          image={image}
          url={vaultUrl(imagePath(path, image.src))}
          selected={selection?.kind === 'images' && selection.id === image.id}
          interactive={tool === 'select'}
          onPointerDown={(e) => moveImage(e, image)}
          onResizeStart={(e) => resizeImageBy(e, image)}
        />
      ))}

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
          found={
            currentHit?.box === box.id && currentHit.page === number
              ? 'current'
              : hits.some((h) => h.box === box.id)
                ? 'hit'
                : undefined
          }
          editing={editing?.id === box.id}
          interactive={tool === 'select' || tool === 'text'}
          resizable={tool === 'select'}
          onPointerDown={(e) => onBoxPointerDown(e, box)}
          onDoubleClick={() => startEditing(box)}
          onResizeStart={(e) => resizeBox(e, box)}
          onCommit={(markdown, claudeWrote) => commitBox(box, markdown, claudeWrote)}
          page={number}
          fitPage={fitPage}
          onLateAnswer={(original, answer) => lateAnswer(box.id, original, answer)}
        />
      ))}

      {ghost && <GhostView ghost={ghost} scale={scale} />}

      {guides.x !== null && (
        <div className="snap-guide" style={{ left: guides.x, top: 0, width: 1 / scale, height }} />
      )}
      {guides.y !== null && (
        <div
          className="snap-guide"
          style={{ left: 0, top: guides.y, width: totalWidth, height: 1 / scale }}
        />
      )}
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
