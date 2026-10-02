import { useState } from 'react'
import { draggingFiles, importDroppedFiles } from '../lib/drop'
import { displayName, findNode } from '../lib/tree'
import { PdfViewer } from '../pdf/PdfViewer'
import { useApp } from '../store'

export function Workspace(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const activeFile = useApp((s) => s.activeFile)
  const node = activeFile ? findNode(nodes, activeFile) : null
  const [dropping, setDropping] = useState(false)

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
      e.preventDefault()
      setDropping(false)
      if (draggingFiles(e)) importDroppedFiles(e)
    }
  }
  const className = (extra: string): string =>
    ['workspace', extra, dropping ? 'dropping' : ''].filter(Boolean).join(' ')

  if (!node) {
    return (
      <main className={className('empty')} {...dropProps}>
        <p className="muted">Select a page in the sidebar, or drop a PDF here to import it.</p>
      </main>
    )
  }

  if (node.kind === 'pdf') {
    return (
      <main className={className('')} {...dropProps}>
        <PdfViewer key={node.path} path={node.path} title={displayName(node)} />
      </main>
    )
  }

  const crumbs = node.path.split('/').slice(0, -1)
  return (
    <main className={className('padded')} {...dropProps}>
      <header className="workspace-header">
        <nav className="breadcrumb" aria-label="Location">
          {crumbs.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </nav>
        <h1>{displayName(node)}</h1>
      </header>
      <p className="muted">The Markdown editor is not built yet.</p>
    </main>
  )
}
