import { useEffect, useRef, useState } from 'react'
import logo from '../../../../build/icon.svg'
import { CanvasView } from '../canvas/CanvasView'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { SidebarButton } from './SidebarButton'
import { TREE_FILE, draggingFiles, draggingTreeFile, importDroppedFiles } from '../lib/drop'
import {
  MAX_PANES,
  dropSide,
  gridOf,
  moveBorder,
  paneRects,
  sideOf,
  type Grid,
  type Rect,
  type Side
} from '../lib/grid'
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

const onScreenPdf = (): string | undefined => useApp.getState().pdfView?.path

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
      <div className="grid-empty-actions">
        <button
          className="button"
          onClick={() => {
            useApp.getState().focusPane(index)
            useApp.getState().setOverlay('switcher')
          }}
        >
          Find a file
        </button>
        <button className="text-button" onClick={() => useApp.getState().closePane(index)}>
          Close this pane
        </button>
      </div>
    </div>
  )
}

/** Drags the border after column `column` (or, with `row`, after that pane in the column). */
function startBorderDrag(
  e: React.PointerEvent,
  host: HTMLElement,
  grid: Grid,
  column: number,
  row?: number
): void {
  e.preventDefault()
  e.currentTarget.setPointerCapture(e.pointerId)
  const box = host.getBoundingClientRect()
  const start = row === undefined ? e.clientX : e.clientY
  const onMove = (ev: PointerEvent): void => {
    if (row === undefined) {
      const delta = (ev.clientX - start) / box.width
      useApp.getState().setGridSizes(moveBorder(grid.widths, column, delta), grid.heights)
    } else {
      const delta = (ev.clientY - start) / box.height
      const heights = grid.heights.map((h, c) => (c === column ? moveBorder(h, row, delta) : h))
      useApp.getState().setGridSizes(grid.widths, heights)
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', onMove), {
    once: true
  })
}

const percent = (r: Rect): React.CSSProperties => ({
  left: `${r.left * 100}%`,
  top: `${r.top * 100}%`,
  width: `${r.width * 100}%`,
  height: `${r.height * 100}%`
})

interface TreeDrop {
  pane: number
  side: Side | 'center'
  rect: Rect
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
  const mainRef = useRef<HTMLElement>(null)
  // Where a file dragged from the sidebar would open.
  const [treeDrop, setTreeDrop] = useState<TreeDrop | null>(null)

  useEffect(() => {
    const clear = (): void => setTreeDrop(null)
    window.addEventListener('dragend', clear)
    return () => window.removeEventListener('dragend', clear)
  }, [])

  /** The pane under the pointer and which part of it a file from the sidebar goes to. */
  const treeDropAt = (e: React.DragEvent): TreeDrop | null => {
    const host = mainRef.current!.getBoundingClientRect()
    const x = (e.clientX - host.left) / host.width
    const y = (e.clientY - host.top) / host.height
    const layout =
      grid ??
      (lectureMode
        ? gridOf([slidesFile, summaryFile], [split, 1 - split])
        : activeFile
          ? gridOf([activeFile])
          : null)
    if (!layout) return { pane: 0, side: 'center', rect: { left: 0, top: 0, width: 1, height: 1 } }
    const rects = paneRects(layout)
    const pane = rects.findIndex(
      (r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height
    )
    if (pane < 0) return null
    const r = rects[pane]
    const full = layout.panes.length >= MAX_PANES
    const side = full ? 'center' : dropSide((x - r.left) / r.width, (y - r.top) / r.height)
    return { pane, side, rect: sideOf(r, side) }
  }

  const dropProps = {
    ref: mainRef,
    // Capture: an editor under the pointer would otherwise take the drop as text.
    onDragOverCapture(e: React.DragEvent) {
      if (!draggingTreeFile(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'link'
      const next = treeDropAt(e)
      if (JSON.stringify(next) !== JSON.stringify(treeDrop)) setTreeDrop(next)
    },
    onDropCapture(e: React.DragEvent) {
      if (!draggingTreeFile(e)) return
      e.preventDefault()
      e.stopPropagation()
      const target = treeDropAt(e)
      setTreeDrop(null)
      if (target) useApp.getState().openBeside(e.dataTransfer.getData(TREE_FILE), target)
    },
    onDragOver(e: React.DragEvent) {
      if (!draggingFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    },
    onDragLeave(e: React.DragEvent) {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return
      setDropping(false)
      setTreeDrop(null)
    },
    onDrop(e: React.DragEvent) {
      // Images dropped on a slide were already put there by the page.
      const handled = e.defaultPrevented
      e.preventDefault()
      setDropping(false)
      // A transcript or recording dropped on open slides is about them.
      if (draggingFiles(e) && !handled) importDroppedFiles(e, undefined, onScreenPdf())
    }
  }
  const className = (extra: string): string =>
    ['workspace', extra, dropping ? 'dropping' : ''].filter(Boolean).join(' ')
  const dropHint = treeDrop && (
    <div
      className={treeDrop.side === 'center' ? 'pane-drop-hint replace' : 'pane-drop-hint'}
      style={percent(treeDrop.rect)}
    />
  )

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
    const rects = paneRects(grid)
    let empty = 0
    return (
      <main className={className('grid')} {...dropProps}>
        {grid.panes.map((path, i) => {
          const r = rects[i]
          const edges = [r.left > 0 && 'after-left', r.top > 0 && 'after-top']
          return (
            <section
              // Keyed by file, so a pane that moves when another closes keeps its viewer.
              key={path ?? `empty-${empty++}`}
              className={['grid-pane', i === grid.focus && 'focused', ...edges]
                .filter(Boolean)
                .join(' ')}
              style={percent(r)}
              aria-label={`Pane ${i + 1}`}
              onPointerDownCapture={() => useApp.getState().focusPane(i)}
              onFocusCapture={() => useApp.getState().focusPane(i)}
            >
              {viewFor(path) ?? <EmptyPane index={i} />}
            </section>
          )
        })}
        {grid.widths.slice(0, -1).map((_, c) => (
          <div
            key={`col-${c}`}
            className="grid-border vertical"
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the panes"
            style={{ left: `${grid.widths.slice(0, c + 1).reduce((a, b) => a + b) * 100}%` }}
            onPointerDown={(e) => startBorderDrag(e, mainRef.current!, grid, c)}
          />
        ))}
        {grid.heights.flatMap((h, c) =>
          h.slice(0, -1).map((_, row) => {
            const r = rects[grid.columns.slice(0, c).reduce((a, b) => a + b, 0) + row]
            return (
              <div
                key={`row-${c}-${row}`}
                className="grid-border horizontal"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Drag to resize the panes"
                style={{
                  left: `${r.left * 100}%`,
                  width: `${r.width * 100}%`,
                  top: `${(r.top + r.height) * 100}%`
                }}
                onPointerDown={(e) => startBorderDrag(e, mainRef.current!, grid, c, row)}
              />
            )
          })
        )}
        {dropHint}
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
        {dropHint}
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
        {dropHint}
      </main>
    )
  }
  return (
    <main className={className('')} {...dropProps}>
      {view}
      {dropHint}
    </main>
  )
}
