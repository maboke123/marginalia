import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { DEFAULT_MARGIN_WIDTH, type LoadedAnnotations } from '../../../shared/annotations'
import { AnnotationToolbar } from '../annotations/AnnotationToolbar'
import { AnnotationContext } from '../annotations/context'
import { addItem, createAnnotationDoc, removeItems, type AnnotationDoc } from '../annotations/doc'
import { highlightFromSelection, selectedTextLayer } from '../annotations/selection'
import { Icon } from '../components/Icon'
import { registerFlush } from '../lib/flush'
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

interface Loaded {
  pdf: PDFDocumentProxy
  sizes: PageSize[]
  startPage: number
  /** An error message when the sidecar could not be read; annotations are then off. */
  annotations: LoadedAnnotations | string
}

/** Where the view is pinned while the scale changes: a point on a page at some height in the view. */
interface Anchor {
  page: number
  fraction: number
  viewY: number
}

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
      const startPage = Math.min(Math.max(1, lastPage ?? 1), sizes.length)
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

const TOOL_KEYS: Record<string, Tool> = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text' }

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
  const margin = loadedFile?.marginWidth ?? DEFAULT_MARGIN_WIDTH
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
  const highlightColor = useApp((s) => s.ink.highlightColor)
  const showError = useApp((s) => s.showError)
  const [selectionAt, setSelectionAt] = useState<{ x: number; y: number } | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [scrollTop, setScrollTop] = useState(0)
  const anchor = useRef<Anchor>({ page: startPage, fraction: 0, viewY: VIEW_PADDING })
  const setPdfView = useApp((s) => s.setPdfView)

  const scale = zoom === 'fit' ? fitWidthScale(sizes, viewport.width, margin) : zoom
  const layout = useMemo(() => layoutPages(sizes, scale, margin), [sizes, scale, margin])
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
    const { page: p, fraction, viewY } = anchor.current
    el.scrollTop = layout.tops[p - 1] + fraction * layout.heights[p - 1] - viewY
    setScrollTop(el.scrollTop)
  }, [layout, viewport.width])

  const onScroll = useCallback(() => {
    const el = scrollRef.current!
    setScrollTop(el.scrollTop)
    setSelectionAt(null)
    const [first] = pagesBetween(layout, el.scrollTop, el.scrollTop + 1)
    anchor.current = {
      page: first + 1,
      fraction: (el.scrollTop - layout.tops[first]) / layout.heights[first],
      viewY: 0
    }
  }, [layout])

  const page = viewport.height ? mostVisiblePage(layout, scrollTop, viewport.height) : startPage

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
    let dirty = false
    const save = async (): Promise<void> => {
      clearTimeout(timer)
      if (!dirty) return
      dirty = false
      await window.api.vault
        .writeAnnotations(path, {
          version: 1,
          pdf: path.split('/').pop()!,
          pdfSha256,
          marginWidth: margin,
          pages: activeDoc.getState().pages
        })
        .catch((err: Error) => showError(`Annotations not saved: ${err.message}`))
    }
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

  const highlightSelection = useCallback((): boolean => {
    const result = activeDoc && highlightFromSelection(highlightColor)
    if (!result) return false
    activeDoc.getState().change((p) => addItem(p, result.page, 'highlights', result.highlight))
    window.getSelection()?.removeAllRanges()
    setSelectionAt(null)
    return true
  }, [activeDoc, highlightColor])

  // Offer a "Highlight" button at the end of a text selection on a slide.
  const updateSelectionAction = useCallback(() => {
    const layer = selectedTextLayer()
    if (!activeDoc || !layer || !viewerRef.current?.contains(layer)) {
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
  }, [activeDoc])

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
      anchor.current = { page: i + 1, fraction: (y - layout.tops[i]) / layout.heights[i], viewY }
      setZoom(clampScale(next))
    },
    [layout]
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

  const goTo = useCallback(
    (n: number) => {
      const target = Math.min(Math.max(1, n), sizes.length)
      scrollRef.current!.scrollTop = layout.tops[target - 1] - VIEW_PADDING
    },
    [layout, sizes.length]
  )

  function onKeyDown(e: React.KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    const state = activeDoc?.getState()

    if (state && ctrl && key === 'z' && !e.shiftKey) state.undo()
    else if (state && ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) state.redo()
    else if (state && !ctrl && key === 'h' && selectedTextLayer()) highlightSelection()
    else if (state && !ctrl && !e.altKey && TOOL_KEYS[key]) setTool(TOOL_KEYS[key])
    else if (e.key === 'Escape') {
      setTool('select')
      state?.select(null)
    } else if (state?.selection && (e.key === 'Delete' || e.key === 'Backspace')) {
      const { page, kind, id } = state.selection
      state.change((p) => removeItems(p, page, kind, [id]))
      state.select(null)
    } else if (ctrl && (e.key === '=' || e.key === '+')) zoomTo(stepZoom(scale, 1))
    else if (ctrl && e.key === '-') zoomTo(stepZoom(scale, -1))
    else if (ctrl && e.key === '0') setZoom('fit')
    else if (!ctrl && e.key === 'ArrowRight') goTo(page + 1)
    else if (!ctrl && e.key === 'ArrowLeft') goTo(page - 1)
    else return
    e.preventDefault()
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
        <AnnotationToolbar doc={activeDoc} />
        <span className="pdf-title">{title}</span>
        <PageInput page={page} count={sizes.length} onGo={goTo} />
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
          onPointerUp={() => setTimeout(updateSelectionAction)}
        >
          <div className="pdf-content" style={{ height: layout.totalHeight, width: contentWidth }}>
            {viewport.width > 0 &&
              sizes.map((size, i) => (
                <PdfPage
                  key={i}
                  pdf={pdf}
                  number={i + 1}
                  size={size}
                  margin={margin}
                  top={layout.tops[i]}
                  left={(contentWidth - layout.widths[i]) / 2}
                  scale={scale}
                  rendered={i >= first && i <= last}
                />
              ))}
          </div>
        </div>
      </AnnotationContext.Provider>

      {selectionAt && (
        <button
          className="button selection-action"
          style={{ left: selectionAt.x, top: selectionAt.y }}
          onPointerDown={(e) => e.preventDefault()}
          onClick={highlightSelection}
        >
          Highlight <span className="muted">H</span>
        </button>
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
