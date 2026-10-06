import { useState } from 'react'
import logo from '../../../../build/icon.svg'
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

export function Workspace(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const activeFile = useApp((s) => s.activeFile)
  const lectureMode = useApp((s) => s.lectureMode)
  const slidesFile = useApp((s) => s.slidesFile)
  const summaryFile = useApp((s) => s.summaryFile)
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
    return <MarkdownEditor key={node.path} path={node.path} title={displayName(node)} />
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
        <img className="empty-logo" src={logo} alt="" width={40} height={40} />
        <p className="muted">Select a page in the sidebar, or drop a PDF here to import it.</p>
        <SidebarButton />
      </main>
    )
  }
  return (
    <main className={className('')} {...dropProps}>
      {view}
    </main>
  )
}
