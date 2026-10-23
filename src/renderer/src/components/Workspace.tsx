import { useState } from 'react'
import logo from '../../../../build/icon.svg'
import { CanvasView } from '../canvas/CanvasView'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { SidebarButton } from './SidebarButton'
import { draggingFiles, importDroppedFiles } from '../lib/drop'
import { displayName, findNode } from '../lib/tree'
import { PdfViewer } from '../pdf/PdfViewer'
import { useApp } from '../store'

const SPLIT_KEY = 'lecture-split'

function loadSplit(): number {
  try {
    const value = Number(localStorage.getItem(SPLIT_KEY))
    return value > 0.2 && value < 0.8 ? value : 0.55
  } catch {
    return 0.55
  }
}

/** A pane of the grid with nothing in it yet: recent files to put there. */
function EmptyPane({ index }: { index: number }): React.JSX.Element {
  const recent = useApp((s) => s.recentFiles)
  const grid = useApp((s) => s.grid)
  const nodes = useApp((s) => s.nodes)
  const choices = recent.filter((p) => !grid?.panes.includes(p) && findNode(nodes, p)).slice(0, 8)
  const open = (path: string): void => {
    useApp.getState().focusPane(index)
    useApp.getState().openFile(path)
  }
  return (
    <div className="grid-empty">
      <SidebarButton />
      <p className="muted">
        Open a file from the sidebar or with Ctrl+P while this pane is chosen, or pick one:
      </p>
      <ul>
        {choices.map((path) => (
          <li key={path}>
            <button className="text-button" onClick={() => open(path)}>
              {displayName(findNode(nodes, path)!)}
              <span className="muted">{path.split('/').slice(0, -1).join(' / ')}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button"
        onClick={() => {
          useApp.getState().focusPane(index)
          useApp.getState().setOverlay('switcher')
        }}
      >
        Find a file
      </button>
    </div>
  )
}

export function Workspace(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const activeFile = useApp((s) => s.activeFile)
  const lectureMode = useApp((s) => s.lectureMode)
  const slidesFile = useApp((s) => s.slidesFile)
  const summaryFile = useApp((s) => s.summaryFile)
  const grid = useApp((s) => s.grid)
  const [dropping, setDropping] = useState(false)
  const [split, setSplit] = useState(loadSplit)

  const dropProps = {
    onDragOver(e: React.DragEvent) {
      if (!draggingFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    },
    onDragLeave(e: React.DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
    },
    onDrop(e: React.DragEvent) {
      // Images dropped on a slide were already put there by the page.
      const handled = e.defaultPrevented
      e.preventDefault()
      setDropping(false)
      if (draggingFiles(e) && !handled) importDroppedFiles(e)
    }
  }
  const className = (extra: string): string =>
    ['workspace', extra, dropping ? 'dropping' : ''].filter(Boolean).join(' ')

  const viewFor = (path: string | null): React.JSX.Element | null => {
    const node = path ? findNode(nodes, path) : null
    if (!node) return null
    if (node.kind === 'pdf') {
      return <PdfViewer key={node.path} path={node.path} title={displayName(node)} />
    }
    if (node.kind === 'canvas') {
      return <CanvasView key={node.path} path={node.path} title={displayName(node)} />
    }
    return <MarkdownEditor key={node.path} path={node.path} title={displayName(node)} />
  }

  if (grid) {
    return (
      <main className={className(`grid grid-${grid.panes.length}`)} {...dropProps}>
        {grid.panes.map((path, i) => (
          <section
            key={i}
            className={i === grid.focus ? 'grid-pane focused' : 'grid-pane'}
            aria-label={`Pane ${i + 1}`}
            onPointerDownCapture={() => useApp.getState().focusPane(i)}
            onFocusCapture={() => useApp.getState().focusPane(i)}
          >
            {viewFor(path) ?? <EmptyPane index={i} />}
          </section>
        ))}
      </main>
    )
  }

  if (lectureMode) {
    const startResize = (e: React.PointerEvent): void => {
      const host = e.currentTarget.parentElement!
      e.currentTarget.setPointerCapture(e.pointerId)
      let latest = split
      const onMove = (ev: PointerEvent): void => {
        const r = host.getBoundingClientRect()
        latest = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width))
        setSplit(latest)
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        try {
          localStorage.setItem(SPLIT_KEY, String(latest))
        } catch {
          // ignore
        }
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp, { once: true })
    }

    return (
      <main className={className('lecture')} {...dropProps}>
        <section className="lecture-pane" style={{ flexBasis: `${split * 100}%` }}>
          {viewFor(slidesFile) ?? (
            <p className="pdf-message">No slides in this section yet. Drop a PDF here.</p>
          )}
        </section>
        <div className="lecture-divider" role="separator" onPointerDown={startResize} />
        <section className="lecture-pane">
          {viewFor(summaryFile) ?? <p className="pdf-message">No summary open.</p>}
        </section>
      </main>
    )
  }

  const view = viewFor(activeFile)
  if (!view) {
    return (
      <main className={className('empty')} {...dropProps}>
        <SidebarButton />
        <p className="muted">Select a page in the sidebar, or drop a PDF here to import it.</p>
        <img className="empty-logo" src={logo} alt="" width={160} height={160} />
      </main>
    )
  }
  return (
    <main className={className('')} {...dropProps}>
      {view}
    </main>
  )
}
