import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { useStore } from 'zustand'
import { type LoadedAnnotations, type TextMarkup } from '../../../shared/annotations'
import {
  MAX_BLANKS_PER_SLIDE,
  insertBlankPage,
  isBlankPage,
  removeBlankPage,
  slideOf,
  viewPages
} from '../../../shared/blankPages'
import { MARGIN_WIDTHS } from '../../../shared/settings'
import { comboOf } from '../../../shared/hotkeys'
import { addImageFiles, lastClick } from '../annotations/addImages'
import { AnnotationToolbar } from '../annotations/AnnotationToolbar'
import { AnnotationContext } from '../annotations/context'
import { addItem, createAnnotationDoc, removeItems, type AnnotationDoc } from '../annotations/doc'
import { highlightFromSelection, selectedTextLayer } from '../annotations/selection'
import { ContextMenu } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { registerFlush } from '../lib/flush'
import { registerPdf } from '../lib/open'
import { useApp, type Tool } from '../store'
import {
  VIEW_PADDING,
  clampScale,
  fitWidthScale,
  layoutPages,
  mostVisiblePage,
  pagesBetween,
  stepZoom,
  type PageSize
} from './layout'
import { loadPdf, pageSizes } from './pdfjs'
import { PdfPage } from './PdfPage'
import { SnapshotLayer } from './SnapshotLayer'

interface Loaded {
  pdf: PDFDocumentProxy
  sizes: PageSize[]
  startPage: number
  /** An error message when the sidecar could not be read; annotations are then off. */
  annotations: LoadedAnnotations | string
}

/** Where the view is pinned while the scale changes: a point on a page at some height in the view. */
interface Anchor {
  /** Page key (3, or 3.1 for a blank page), so adding a blank page does not move the view. */
  id: number
  fraction: number
  viewY: number
}

// Stands in for the annotation doc when annotations are off, so hooks stay unconditional.
const NO_DOC = createAnnotationDoc({})

export function PdfViewer({ path, title }: { path: string; title: string }): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    ;(async () => {
      const [data, lastPage, annotations] = await Promise.all([
        window.api.vault.readFile(path),
        window.api.vault.lastPage(path).catch(() => null),
        window.api.vault.readAnnotations(path).catch((err: Error): string => err.message)
      ])
      if (cancelled) return
      task = loadPdf(data)
      const pdf = await task.promise
      if (cancelled) return
      const sizes = await pageSizes(pdf)
      if (cancelled) return
      // A slide link that opened this PDF wins over the remembered page.
      const goto = useApp.getState().pdfGoto
      const wanted = goto?.path === path ? goto.page : lastPage
      const startPage = Math.min(Math.max(1, wanted ?? 1), sizes.length)
      setLoaded({ pdf, sizes, startPage, annotations })
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      cancelled = true
      task?.destroy()
    }
  }, [path])

  if (error) {
    return (
      <div className="pdf-viewer">
        <p className="pdf-message">Could not open this PDF: {error}</p>
      </div>
    )
  }
  if (!loaded) return <div className="pdf-viewer" />
  return <Document path={path} title={title} {...loaded} />
}

const TOOLS: Tool[] = ['select', 'pen', 'highlighter', 'eraser', 'text']

function Document({
  path,
  title,
  pdf,
  sizes,
  startPage,
  annotations
}: Loaded & { path: string; title: string }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const loadedFile = typeof annotations === 'string' ? null : annotations.file
  // A PDF keeps its own margin once annotated; new ones start with the setting.
  const [margin, setMargin] = useState(
    () => loadedFile?.marginWidth ?? useApp.getState().settings.marginWidth
  )
  const savedMargin = useRef(loadedFile?.marginWidth ?? margin)
  // Saves run one after another, so an older one can never land after a newer one.
  const saving = useRef<Promise<void>>(Promise.resolve())
  const [doc] = useState<AnnotationDoc | null>(() =>
    typeof annotations === 'string' ? null : createAnnotationDoc(loadedFile?.pages ?? {})
  )
  // A replaced PDF would put the annotations on the wrong slides, so they wait for a decision.
  const [pdfChanged, setPdfChanged] = useState(
    typeof annotations !== 'string' &&
      !!loadedFile?.pdfSha256 &&
      loadedFile.pdfSha256 !== annotations.pdfSha256
  )
  const activeDoc = pdfChanged ? null : doc
  const tool = useApp((s) => s.tool)
  const setTool = useApp((s) => s.setTool)
  const ink = useApp((s) => s.ink)
  const showError = useApp((s) => s.showError)
  const lectureMode = useApp((s) => s.lectureMode)
  const toggleLecture = useApp((s) => s.toggleLecture)
  const snapshotting = useApp((s) => s.snapshotting)
  const [selectionAt, setSelectionAt] = useState<{ x: number; y: number } | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [scrollTop, setScrollTop] = useState(0)
  const anchor = useRef<Anchor>({ id: startPage, fraction: 0, viewY: VIEW_PADDING })
  const setPdfView = useApp((s) => s.setPdfView)
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; id: number } | null>(null)

  // Blank pages added below slides sit between the PDF's own pages.
  const blankKeys = useStore(activeDoc ?? NO_DOC, (s) =>
    Object.keys(s.pages)
      .filter((k) => isBlankPage(Number(k)))
      .join(',')
  )
  const views = useMemo(
    () => viewPages(sizes.length, Object.fromEntries(blankKeys.split(',').map((k) => [k, k]))),
    [sizes.length, blankKeys]
  )
  const viewSizes = useMemo(() => views.map((v) => sizes[slideOf(v.id) - 1]), [views, sizes])
  const indexOf = useCallback(
    (id: number): number => {
      const i = views.findIndex((v) => v.id === id)
      return i !== -1 ? i : views.findIndex((v) => v.id === slideOf(id))
    },
    [views]
  )

  const scale = zoom === 'fit' ? fitWidthScale(viewSizes, viewport.width, margin) : zoom
  const layout = useMemo(() => layoutPages(viewSizes, scale, margin), [viewSizes, scale, margin])
  const contentWidth = Math.max(viewport.width, layout.maxWidth + 2 * VIEW_PADDING)

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const observer = new ResizeObserver(() =>
      setViewport({ width: el.clientWidth, height: el.clientHeight })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Opening a PDF moves the keyboard to it, so P/H/E/T and the arrow keys work right away.
  useEffect(() => scrollRef.current!.focus({ preventScroll: true }), [])

  // After any change of scale (zoom, fit width, window resize) put the anchored point back.
  // The first run, once the width is known, restores the last page.
  useLayoutEffect(() => {
    const el = scrollRef.current!
    if (!viewport.width) return
    const { id, fraction, viewY } = anchor.current
    const i = indexOf(id)
    el.scrollTop = layout.tops[i] + fraction * layout.heights[i] - viewY
    setScrollTop(el.scrollTop)
  }, [layout, viewport.width, indexOf])

  const onScroll = useCallback(() => {
    const el = scrollRef.current!
    setScrollTop(el.scrollTop)
    setSelectionAt(null)
    const [first] = pagesBetween(layout, el.scrollTop, el.scrollTop + 1)
    anchor.current = {
      id: views[first].id,
      fraction: (el.scrollTop - layout.tops[first]) / layout.heights[first],
      viewY: 0
    }
  }, [layout, views])

  const viewIndex = viewport.height
    ? mostVisiblePage(layout, scrollTop, viewport.height) - 1
    : indexOf(startPage)
  const current = views[viewIndex] ?? views[0]
  // The slide on screen; a blank page counts as the slide it was added after.
  const page = slideOf(current.id)

  // Saved a second after scrolling stops, and once more when the viewer closes so a quick
  // switch to another file does not lose the position.
  const savedPage = useRef(page)
  useEffect(() => {
    setPdfView({ path, page, pageCount: sizes.length })
    savedPage.current = page
    const timer = setTimeout(
      () => window.api.vault.setLastPage(path, page).catch(console.error),
      1000
    )
    return () => clearTimeout(timer)
  }, [path, page, sizes.length, setPdfView])

  useEffect(
    () => () => {
      setPdfView(null)
      window.api.vault.setLastPage(path, savedPage.current).catch(console.error)
    },
    [path, setPdfView]
  )

  // Autosave a second after the last change. Also saved when the viewer closes and,
  // through registerFlush, when the window closes.
  useEffect(() => {
    if (!activeDoc || typeof annotations === 'string') return
    const pdfSha256 = annotations.pdfSha256
    let timer: ReturnType<typeof setTimeout> | undefined
    // A new margin width is saved straight away, like an annotation change.
    let dirty = margin !== savedMargin.current
    const save = (): Promise<void> => {
      clearTimeout(timer)
      if (!dirty) return saving.current
      dirty = false
      savedMargin.current = margin
      const file = {
        version: 1 as const,
        pdf: path.split('/').pop()!,
        pdfSha256,
        marginWidth: margin,
        pages: activeDoc.getState().pages
      }
      saving.current = saving.current.then(() =>
        window.api.vault
          .writeAnnotations(path, file)
          .catch((err: Error) => showError(`Annotations not saved: ${err.message}`))
      )
      return saving.current
    }
    if (dirty) timer = setTimeout(save)
    const unsubscribe = activeDoc.subscribe((state, previous) => {
      if (state.pages === previous.pages) return
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(save, 1000)
    })
    const unregister = registerFlush(save)
    return () => {
      unsubscribe()
      unregister()
      save()
    }
  }, [activeDoc, annotations, path, margin, showError])

  useEffect(
    () => registerPdf({ path, pdf, doc: activeDoc, sizes, margin }),
    [path, pdf, activeDoc, sizes, margin]
  )

  // Highlights use the highlighter colour; lines under or through text use the pen colour,
  // because a yellow line is hard to see.
  const markSelection = useCallback(
    (style: TextMarkup): boolean => {
      const color = style === 'highlight' ? ink.highlightColor : ink.penColor
      const result = activeDoc && highlightFromSelection(color, style)
      if (!result) return false
      activeDoc.getState().change((p) => addItem(p, result.page, 'highlights', result.highlight))
      window.getSelection()?.removeAllRanges()
      setSelectionAt(null)
      return true
    },
    [activeDoc, ink.highlightColor, ink.penColor]
  )

  // Offer a "Highlight" button at the end of a text selection on a slide.
  const updateSelectionAction = useCallback(() => {
    const layer = selectedTextLayer()
    const { setPdfSelection } = useApp.getState()
    if (!layer || !viewerRef.current?.contains(layer)) {
      setPdfSelection(null)
      setSelectionAt(null)
      return
    }
    const text = window.getSelection()!.toString().replace(/s+/g, ' ').trim()
    setPdfSelection(text ? { path, page: Number(layer.dataset.page), text } : null)
    if (!activeDoc) {
      setSelectionAt(null)
      return
    }
    const rects = [...window.getSelection()!.getRangeAt(0).getClientRects()].filter(
      (r) => r.width > 0 && r.height > 0 && r.height < layer.getBoundingClientRect().height / 2
    )
    const last = rects[rects.length - 1]
    if (!last) return
    const host = viewerRef.current.getBoundingClientRect()
    setSelectionAt({ x: last.right - host.left, y: last.bottom - host.top + 6 })
  }, [activeDoc, path])

  /** Ends a selection of slide text in this viewer, together with its Highlight buttons. */
  const clearTextSelection = useCallback((): void => {
    const layer = selectedTextLayer()
    if (!layer || !viewerRef.current?.contains(layer)) return
    window.getSelection()?.removeAllRanges()
    setSelectionAt(null)
    useApp.getState().setPdfSelection(null)
  }, [])

  useEffect(() => () => useApp.getState().setPdfSelection(null), [])

  useEffect(() => {
    const onChange = (): void => {
      if (window.getSelection()?.isCollapsed) setSelectionAt(null)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  const zoomTo = useCallback(
    (next: number, viewY = 0) => {
      const el = scrollRef.current!
      const y = el.scrollTop + viewY
      const [i] = pagesBetween(layout, y, y + 1)
      anchor.current = {
        id: views[i].id,
        fraction: (y - layout.tops[i]) / layout.heights[i],
        viewY
      }
      setZoom(clampScale(next))
    },
    [layout, views]
  )

  // Ctrl+wheel zooms around the mouse. React's wheel listener is passive and cannot
  // prevent the default page zoom, so this one is attached by hand.
  useEffect(() => {
    const el = scrollRef.current!
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY / 500)
      zoomTo(scale * factor, e.clientY - el.getBoundingClientRect().top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [scale, zoomTo])

  const goToView = useCallback(
    (i: number) => {
      const target = Math.min(Math.max(0, i), views.length - 1)
      scrollRef.current!.scrollTop = layout.tops[target] - VIEW_PADDING
    },
    [layout, views.length]
  )

  /** To a page of the PDF (a slide number, as in slide links). */
  const goTo = useCallback(
    (n: number) => goToView(indexOf(Math.min(Math.max(1, Math.round(n)), sizes.length))),
    [goToView, indexOf, sizes.length]
  )

  function addBlankPage(below: number): void {
    if (!activeDoc) return
    const result = insertBlankPage(activeDoc.getState().pages, below)
    if (!result) {
      showError(`A slide can have at most ${MAX_BLANKS_PER_SLIDE} blank pages`)
      return
    }
    // Once the new page is laid out, the view moves to it.
    anchor.current = { id: result.id, fraction: 0, viewY: VIEW_PADDING }
    activeDoc.getState().change(() => result.pages)
    // Back to the slides, so T, P and the rest work on the new page right away.
    scrollRef.current?.focus({ preventScroll: true })
  }

  function removeBlank(id: number): void {
    activeDoc?.getState().change((p) => removeBlankPage(p, id))
    scrollRef.current?.focus({ preventScroll: true })
  }

  function onPageContextMenu(e: React.MouseEvent): void {
    const el = (e.target as Element).closest<HTMLElement>('.pdf-page')
    if (!el || !activeDoc) return
    e.preventDefault()
    setPageMenu({ x: e.clientX, y: e.clientY, id: Number(el.dataset.page) })
  }

  // Clicking a slide link while this PDF is already open.
  useEffect(
    () =>
      useApp.subscribe((state, previous) => {
        const goto = state.pdfGoto
        if (goto && goto !== previous.pdfGoto && goto.path === path) goTo(goto.page)
      }),
    [path, goTo]
  )

  function onKeyDown(e: React.KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const state = activeDoc?.getState()
    const { hotkeys } = useApp.getState().settings
    const combo = comboOf(e)
    const toolKey = TOOLS.find((t) => hotkeys[t] === combo)

    if (state && ctrl && key === 'z' && !e.shiftKey) state.undo()
    else if (state && ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) state.redo()
    else if (state && combo === hotkeys.highlighter && selectedTextLayer()) {
      markSelection('highlight')
    } else if (state && !ctrl && key === 'u' && selectedTextLayer()) markSelection('underline')
    else if (state && toolKey) setTool(toolKey)
    else if (e.key === 'Escape') {
      setTool('select')
      clearTextSelection()
      state?.select(null)
    } else if (state?.selection && (e.key === 'Delete' || e.key === 'Backspace')) {
      const { page, kind, id } = state.selection
      state.change((p) => removeItems(p, page, kind, [id]))
      state.select(null)
    } else if (ctrl && (e.key === '=' || e.key === '+')) zoomTo(stepZoom(scale, 1))
    else if (ctrl && e.key === '-') zoomTo(stepZoom(scale, -1))
    else if (ctrl && e.key === '0') setZoom('fit')
    else if (!ctrl && e.key === 'ArrowRight') goToView(viewIndex + 1)
    else if (!ctrl && e.key === 'ArrowLeft') goToView(viewIndex - 1)
    else return
    e.preventDefault()
  }

  // Ctrl+V with a screenshot: where I last clicked if that is on the page in view,
  // otherwise in the margin of that page.
  function onPaste(e: React.ClipboardEvent): void {
    const target = e.target as HTMLElement
    if (!activeDoc || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    const click = lastClick(activeDoc)
    const on = click?.page === current.id ? click : null
    const size = viewSizes[viewIndex]
    addImageFiles(activeDoc, path, files, {
      page: current.id,
      width: size.width,
      height: size.height,
      margin,
      at: on?.point ?? null
    })
  }

  // Render the visible pages plus one screen above and below.
  const [first, last] = pagesBetween(
    layout,
    scrollTop - viewport.height,
    scrollTop + 2 * viewport.height
  )

  return (
    <div className="pdf-viewer" ref={viewerRef}>
      <div className="pdf-toolbar">
        <AnnotationToolbar doc={activeDoc} pageWidth={(n) => sizes[slideOf(n) - 1].width} />
        <span className="pdf-title" title={title}>
          {title}
        </span>
        {/* One group, so a narrow pane moves it to a second line in one piece. */}
        <div className="pdf-view-controls">
          <PageInput page={page} count={sizes.length} onGo={goTo} />
          <select
            className="toolbar-select"
            title="Width of the margin next to each slide"
            aria-label="Margin"
            value={margin}
            disabled={!activeDoc}
            onChange={(e) => setMargin(Number(e.target.value))}
          >
            {MARGIN_WIDTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.name}
              </option>
            ))}
          </select>
          <div className="pdf-zoom">
            <button
              className="icon-button"
              title="Zoom out (Ctrl+-)"
              aria-label="Zoom out"
              onClick={() => zoomTo(stepZoom(scale, -1))}
            >
              <Icon name="minus" />
            </button>
            <span className="pdf-zoom-level">{Math.round(scale * 100)}%</span>
            <button
              className="icon-button"
              title="Zoom in (Ctrl+=)"
              aria-label="Zoom in"
              onClick={() => zoomTo(stepZoom(scale, 1))}
            >
              <Icon name="plus" />
            </button>
            <button
              className={zoom === 'fit' ? 'text-button pressed' : 'text-button'}
              title="Fit width (Ctrl+0)"
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              Fit width
            </button>
          </div>
          <button
            className="icon-button"
            title="Add a blank page below this one, for notes that do not fit"
            aria-label="Add blank page"
            disabled={!activeDoc}
            onClick={() => addBlankPage(current.id)}
          >
            <Icon name="addPage" />
          </button>
          <button
            className="icon-button"
            title="Export a copy with the annotations drawn in"
            aria-label="Export annotated PDF"
            onClick={() => useApp.getState().exportPdf(path)}
          >
            <Icon name="export" />
          </button>
          {/* In lecture mode the note's header has the button, at the window's right edge. */}
          {!lectureMode && (
            <button
              className="icon-button"
              title={`Lecture mode (${useApp.getState().settings.hotkeys.lecture})`}
              aria-label="Lecture mode"
              aria-pressed={false}
              onClick={() => toggleLecture()}
            >
              <Icon name="columns" />
            </button>
          )}
        </div>
      </div>

      {typeof annotations === 'string' && (
        <div className="pdf-banner" role="status">
          {annotations}. The file was left untouched; fix or remove it to annotate again.
        </div>
      )}
      {pdfChanged && (
        <div className="pdf-banner" role="status">
          <span>
            This PDF changed since you annotated it, so your annotations are hidden to keep them off
            the wrong slides.
          </span>
          <button className="button" onClick={() => setPdfChanged(false)}>
            Show annotations anyway
          </button>
        </div>
      )}

      <AnnotationContext.Provider value={activeDoc}>
        <div
          ref={scrollRef}
          className={`pdf-scroll tool-${tool}`}
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onPointerDownCapture={(e) => {
            // Most of the page cannot be selected (user-select: none), and a click there
            // would leave an old selection standing. A click on slide text starts a new one.
            if (!(e.target as Element).closest('.textLayer span')) clearTextSelection()
          }}
          onPointerUp={() => setTimeout(updateSelectionAction)}
          onContextMenu={onPageContextMenu}
        >
          <div className="pdf-content" style={{ height: layout.totalHeight, width: contentWidth }}>
            {viewport.width > 0 &&
              views.map((view, i) => (
                <PdfPage
                  key={view.id}
                  pdf={pdf}
                  path={path}
                  number={view.id}
                  blank={view.pdfPage === null}
                  size={viewSizes[i]}
                  margin={margin}
                  top={layout.tops[i]}
                  left={(contentWidth - layout.widths[i]) / 2}
                  scale={scale}
                  rendered={i >= first && i <= last}
                />
              ))}
            {snapshotting && (
              <SnapshotLayer
                pdf={pdf}
                layout={layout}
                views={views}
                sizes={viewSizes}
                scale={scale}
                contentWidth={contentWidth}
              />
            )}
          </div>
        </div>
      </AnnotationContext.Provider>

      {pageMenu && (
        <ContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          onClose={() => setPageMenu(null)}
          items={[
            { label: 'Add blank page below', onSelect: () => addBlankPage(pageMenu.id) },
            ...(isBlankPage(pageMenu.id)
              ? [
                  {
                    label: 'Remove this blank page',
                    danger: true,
                    hint: 'Ctrl+Z brings it back',
                    onSelect: () => removeBlank(pageMenu.id)
                  }
                ]
              : [])
          ]}
        />
      )}

      {selectionAt && (
        <div
          className="selection-action"
          role="toolbar"
          aria-label="Mark selected text"
          style={{ left: selectionAt.x, top: selectionAt.y }}
          onPointerDown={(e) => e.preventDefault()}
        >
          <button className="text-button" onClick={() => markSelection('highlight')}>
            Highlight <span className="muted">H</span>
          </button>
          <button className="text-button" onClick={() => markSelection('underline')}>
            Underline <span className="muted">U</span>
          </button>
          <button className="text-button" onClick={() => markSelection('strikethrough')}>
            Strikethrough
          </button>
        </div>
      )}
    </div>
  )
}

function PageInput({
  page,
  count,
  onGo
}: {
  page: number
  count: number
  onGo(page: number): void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="pdf-page-input">
      <input
        aria-label="Page"
        value={draft ?? String(page)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft) {
            onGo(Number(draft))
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') e.currentTarget.blur()
        }}
      />
      <span className="muted">/ {count}</span>
    </label>
  )
}
