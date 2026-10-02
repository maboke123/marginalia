import { useMemo, useState } from 'react'
import type { VaultNode } from '../../../shared/types'
import { fuzzyMatch } from '../lib/fuzzy'
import { findNode, isFolder, parentOf } from '../lib/tree'
import { useApp } from '../store'
import { Icon, type IconName } from './Icon'
import { useListKeys } from '../lib/useListKeys'
import { Overlay } from './Overlay'

const ICONS: Record<VaultNode['kind'], IconName> = {
  notebook: 'notebook',
  section: 'folder',
  markdown: 'page',
  pdf: 'pdf'
}

function everything(nodes: VaultNode[], out: VaultNode[] = []): VaultNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children) everything(node.children, out)
  }
  return out
}

/** The name with matched letters in bold; `indices` count from the start of the path. */
function Highlighted({
  text,
  offset,
  indices
}: {
  text: string
  offset: number
  indices: number[]
}): React.JSX.Element {
  const marked = new Set(indices.map((i) => i - offset))
  return <>{[...text].map((ch, i) => (marked.has(i) ? <b key={i}>{ch}</b> : ch))}</>
}

/** Ctrl+P: jump to any notebook, section, note or PDF by typing part of its name. */
export function QuickSwitcher(): React.JSX.Element {
  const nodes = useApp((s) => s.nodes)
  const recent = useApp((s) => s.recentFiles)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    if (!query.trim()) {
      return recent
        .map((p) => findNode(nodes, p))
        .filter((n): n is VaultNode => !!n)
        .map((node) => ({ node, indices: [] as number[] }))
    }
    return everything(nodes)
      .map((node) => {
        const match = fuzzyMatch(query, node.path)
        if (!match) return null
        // A match inside the name counts more than one spread over the folders above it.
        const nameStart = node.path.length - node.name.length
        const inName = match.indices.filter((i) => i >= nameStart).length
        return { node, indices: match.indices, score: match.score + inName * 0.5 }
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
  }, [query, nodes, recent])

  const open = (node: VaultNode): void => {
    const app = useApp.getState()
    app.setOverlay(null)
    if (isFolder(node)) {
      app.select(node.path)
      const parts = node.path.split('/')
      parts.forEach((_, i) => app.setExpanded(parts.slice(0, i + 1).join('/'), true))
    } else {
      app.openFile(node.path)
    }
  }

  const { active, setActive, onKeyDown } = useListKeys(results.length, (i) => open(results[i].node))

  return (
    <Overlay label="Go to file">
      <input
        className="overlay-input"
        autoFocus
        value={query}
        placeholder="Go to a notebook, section, note or PDF"
        aria-label="Go to file"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ul className="overlay-list" role="listbox">
        {!query.trim() && results.length > 0 && <li className="overlay-group">Recent</li>}
        {results.map(({ node, indices }, i) => {
          const parent = parentOf(node.path)
          return (
            <li
              key={node.path}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'overlay-item active' : 'overlay-item'}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                open(node)
              }}
            >
              <Icon name={ICONS[node.kind]} />
              <span className="overlay-name">
                <Highlighted
                  text={node.name}
                  offset={node.path.length - node.name.length}
                  indices={indices}
                />
              </span>
              {parent && <span className="overlay-path muted">{parent}</span>}
            </li>
          )
        })}
        {query.trim() && results.length === 0 && (
          <li className="overlay-empty muted">Nothing called “{query}”</li>
        )}
      </ul>
    </Overlay>
  )
}
