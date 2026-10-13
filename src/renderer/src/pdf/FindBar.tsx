import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useEffect, useRef, useState } from 'react'
import { slideOf, type ViewPage } from '../../../shared/blankPages'
import type { AnnotationDoc } from '../annotations/doc'
import { Icon } from '../components/Icon'
import { useApp } from '../store'
import { findInPdf, useFind, type FindHit } from './find'

// Like a browser, Ctrl+F opens with the last search.
let lastQuery = ''

interface Props {
  path: string
  pdf: PDFDocumentProxy
  views: ViewPage[]
  doc: AnnotationDoc | null
  /** Changes on every Ctrl+F, to put the keyboard back in the field. */
  focusKey: number
  onClose(): void
}

/** Ctrl+F in the slides: finds text on the slides and in my text boxes. */
export function FindBar({ path, pdf, views, doc, focusKey, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState(lastQuery)
  const [searching, setSearching] = useState(false)
  const hits = useFind((s) => s.hits)
  const current = useFind((s) => s.current)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current!.focus()
    inputRef.current!.select()
  }, [focusKey])

  useEffect(() => {
    lastQuery = query
    if (!query.trim()) {
      useFind.setState({ path, hits: [], current: -1 })
      return
    }
    let stale = false
    const timer = setTimeout(async () => {
      setSearching(true)
      const found = await findInPdf(pdf, views, doc?.getState().pages ?? {}, query)
      if (stale) return
      setSearching(false)
      // The first hit from the slide on screen on, like a browser does from where it is.
      const view = useApp.getState().pdfView
      const on = view?.path === path ? view.page : 1
      const next = found.findIndex((h) => slideOf(h.page) >= on)
      useFind.setState({
        path,
        hits: found,
        current: found.length ? Math.max(0, next) : -1
      })
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, path, pdf, views, doc])

  useEffect(() => () => useFind.setState({ path: null, hits: [], current: -1 }), [])

  const step = (by: number): void =>
    useFind.setState((s) =>
      s.hits.length ? { current: (s.current + by + s.hits.length) % s.hits.length } : {}
    )

  const count = !query.trim()
    ? ''
    : hits.length
      ? `${current + 1} of ${hits.length}`
      : searching
        ? 'Searching...'
        : 'No results'

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find in slides and text boxes"
        aria-label="Find in slides and text boxes"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }}
      />
      <span className="muted find-count" aria-live="polite">
        {count}
      </span>
      <button
        className="icon-button"
        title="Previous (Shift+Enter)"
        aria-label="Previous"
        disabled={!hits.length}
        onClick={() => step(-1)}
      >
        <Icon name="up" />
      </button>
      <button
        className="icon-button"
        title="Next (Enter)"
        aria-label="Next"
        disabled={!hits.length}
        onClick={() => step(1)}
      >
        <Icon name="down" />
      </button>
      <button className="icon-button" title="Close (Esc)" aria-label="Close find" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  )
}

const NO_HITS: FindHit[] = []

/** What Ctrl+F found in the slide text of one page, in page points. */
export function FindHits({ path, number }: { path: string; number: number }): React.JSX.Element {
  const hits = useFind((s) => (s.path === path ? s.hits : NO_HITS))
  const current = useFind((s) => (s.path === path ? s.hits[s.current] : undefined))
  return (
    <>
      {hits.map(
        (hit, i) =>
          hit.page === number &&
          !hit.box &&
          hit.rects.map(([x, y, w, h], j) => (
            <div
              key={`${i}-${j}`}
              className={hit === current ? 'find-hit current' : 'find-hit'}
              style={{ left: x, top: y, width: w, height: h }}
            />
          ))
      )}
    </>
  )
}
