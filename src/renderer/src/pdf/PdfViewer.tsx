import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { Icon } from '../components/Icon'
import { useApp } from '../store'
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
      const [data, lastPage] = await Promise.all([
        window.api.vault.readFile(path),
        window.api.vault.lastPage(path).catch(() => null)
      ])
      if (cancelled) return
      task = loadPdf(data)
      const pdf = await task.promise
      if (cancelled) return
      const sizes = await pageSizes(pdf)
      if (cancelled) return
      const startPage = Math.min(Math.max(1, lastPage ?? 1), sizes.length)
      setLoaded({ pdf, sizes, startPage })
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

function Document({
  path,
  title,
  pdf,
  sizes,
  startPage
}: Loaded & { path: string; title: string }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [scrollTop, setScrollTop] = useState(0)
  const anchor = useRef<Anchor>({ page: startPage, fraction: 0, viewY: VIEW_PADDING })
  const setPdfView = useApp((s) => s.setPdfView)

  const scale = zoom === 'fit' ? fitWidthScale(sizes, viewport.width) : zoom
  const layout = useMemo(() => layoutPages(sizes, scale), [sizes, scale])
  const contentWidth = Math.max(viewport.width, layout.maxWidth + 2 * VIEW_PADDING)

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const observer = new ResizeObserver(() =>
      setViewport({ width: el.clientWidth, height: el.clientHeight })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && (e.key === '=' || e.key === '+')) zoomTo(stepZoom(scale, 1))
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
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
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

      <div
        ref={scrollRef}
        className="pdf-scroll"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      >
        <div className="pdf-content" style={{ height: layout.totalHeight, width: contentWidth }}>
          {viewport.width > 0 &&
            sizes.map((_, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                number={i + 1}
                top={layout.tops[i]}
                left={(contentWidth - layout.widths[i]) / 2}
                width={layout.widths[i]}
                height={layout.heights[i]}
                scale={scale}
                rendered={i >= first && i <= last}
              />
            ))}
        </div>
      </div>
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
