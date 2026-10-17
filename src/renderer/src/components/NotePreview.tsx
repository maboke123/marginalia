import { useEffect, useRef, useState } from 'react'
import { drawPages, printNote } from '../lib/notePreview'
import { useApp } from '../store'
import { Icon } from './Icon'

const PAGE_WIDTH = 760

/** The note as Export as PDF would write it, page by page, before saving anything. */
export function NotePreview({ path }: { path: string }): React.JSX.Element {
  const [pages, setPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const name = path.split('/').pop()!.replace(/\.md$/i, '')
  const close = (): void => useApp.getState().showPreview(null)

  useEffect(() => {
    const cancelled = { now: false }
    dialogRef.current?.focus()
    printNote(path)
      .then((pdf) => drawPages(pdf, PAGE_WIDTH * devicePixelRatio))
      .then(
        (canvases) => {
          if (cancelled.now || !listRef.current) return
          for (const canvas of canvases) canvas.className = 'preview-page'
          listRef.current.replaceChildren(...canvases)
          setPages(canvases.length)
        },
        (err: Error) => {
          if (!cancelled.now) setError(err.message)
        }
      )
    return () => {
      cancelled.now = true
    }
  }, [path])

  // On the window: the note's editor can take the focus back right after the dialog opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      useApp.getState().showPreview(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const status = error
    ? `Could not make the preview: ${error}`
    : pages
      ? `${pages} ${pages === 1 ? 'page' : 'pages'}, A4`
      : 'Making the preview...'

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        ref={dialogRef}
        className="preview-dialog"
        role="dialog"
        aria-label="PDF preview"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="preview-header">
          <span className="pane-title">{name}</span>
          <span className="muted" role="status">
            {status}
          </span>
          <button
            className="text-button"
            onClick={() => {
              close()
              void useApp.getState().exportNote(path)
            }}
          >
            Export as PDF...
          </button>
          <button className="icon-button" aria-label="Close preview" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="preview-pages" ref={listRef} />
      </div>
    </div>
  )
}
