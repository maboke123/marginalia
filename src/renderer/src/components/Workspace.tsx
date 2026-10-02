import { displayName, findNode } from '../lib/tree'
import { useApp } from '../store'

export function Workspace(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const activeFile = useApp((s) => s.activeFile)
  const node = activeFile ? findNode(nodes, activeFile) : null

  if (!node) {
    return (
      <main className="workspace empty">
        <p className="muted">Select a page in the sidebar.</p>
      </main>
    )
  }

  const crumbs = node.path.split('/').slice(0, -1)

  return (
    <main className="workspace">
      <header className="workspace-header">
        <nav className="breadcrumb" aria-label="Location">
          {crumbs.map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </nav>
        <h1>{displayName(node)}</h1>
      </header>
      <p className="muted">
        {node.kind === 'pdf' ? 'The slide viewer' : 'The Markdown editor'} is not built yet.
      </p>
    </main>
  )
}
