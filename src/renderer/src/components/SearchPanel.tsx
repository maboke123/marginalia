import { useEffect, useState } from 'react'
import type { SearchHit, SearchResult } from '../../../shared/types'
import { onIndexProgress, type IndexProgress } from '../lib/indexer'
import { parentOf } from '../lib/tree'
import { useListKeys } from '../lib/useListKeys'
import { useApp } from '../store'
import { Icon } from './Icon'
import { Overlay } from './Overlay'

// Kept while the app runs, so Ctrl+Shift+F shows the last search again.
let lastQuery = ''

function Snippet({ hit }: { hit: SearchHit }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let at = 0
  hit.marks.forEach(([from, to], i) => {
    if (from < at) return
    parts.push(hit.snippet.slice(at, from), <mark key={i}>{hit.snippet.slice(from, to)}</mark>)
    at = to
  })
  parts.push(hit.snippet.slice(at))
  return <span className="search-snippet">{parts}</span>
}

/** Ctrl+Shift+F: every word typed, in all notes and all slides. */
export function SearchPanel(): React.JSX.Element {
  const [query, setQuery] = useState(lastQuery)
  const [found, setFound] = useState<SearchResult | null>(null)
  const [ms, setMs] = useState(0)
  const [progress, setProgress] = useState<IndexProgress | null>(null)
  const result = query.trim() ? found : null

  useEffect(() => onIndexProgress(setProgress), [])

  useEffect(() => {
    lastQuery = query
    if (!query.trim()) return
    let stale = false
    const timer = setTimeout(async () => {
      const start = performance.now()
      const next = await window.api.search.query(query).catch(() => null)
      if (stale) return
      setMs(Math.round(performance.now() - start))
      setFound(next)
    }, 120)
    return () => {
      stale = true
      clearTimeout(timer)
    }
    // Indexing progress changes what can be found, so search again when it moves.
  }, [query, progress?.done])

  const hits = result?.hits ?? []
  const open = (hit: SearchHit): void => {
    const app = useApp.getState()
    app.setOverlay(null)
    app.openFile(hit.path, hit.page, hit.line)
  }
  const { active, setActive, onKeyDown } = useListKeys(hits.length, (i) => open(hits[i]))

  return (
    <Overlay label="Search">
      <input
        className="overlay-input"
        autoFocus
        value={query}
        placeholder="Search all notes and slides"
        aria-label="Search"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ul className="overlay-list search-results" role="listbox">
        {hits.map((hit, i) => {
          const first = i === 0 || hits[i - 1].path !== hit.path
          return [
            first && (
              <li key={`file-${hit.path}`} className="overlay-group search-file">
                <Icon name={hit.kind === 'pdf' ? 'pdf' : 'page'} />
                <span>{hit.path.split('/').pop()}</span>
                <span className="muted">{parentOf(hit.path)}</span>
              </li>
            ),
            <li
              key={`${hit.path}-${hit.page ?? hit.line}-${i}`}
              role="option"
              aria-selected={i === active}
              className={
                i === active ? 'overlay-item search-hit active' : 'overlay-item search-hit'
              }
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                open(hit)
              }}
            >
              <span className="search-where muted">
                {hit.page ? `p.${hit.page}` : `line ${hit.line}`}
              </span>
              <Snippet hit={hit} />
            </li>
          ]
        })}
        {result && hits.length === 0 && (
          <li className="overlay-empty muted">No notes or slides contain “{query.trim()}”</li>
        )}
      </ul>
      <div className="overlay-footer muted" role="status">
        {result && (
          <span>
            {hits.length}
            {result.truncated ? '+' : ''} {hits.length === 1 ? 'result' : 'results'} in {ms} ms
          </span>
        )}
        {progress ? (
          <span>
            Reading slides for search: {progress.done} of {progress.total}
          </span>
        ) : (
          !!result?.unindexed && <span>{result.unindexed} PDFs are not searchable yet</span>
        )}
      </div>
    </Overlay>
  )
}
