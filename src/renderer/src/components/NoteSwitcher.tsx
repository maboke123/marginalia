import { useState } from 'react'
import { useApp } from '../store'
import { childrenOf, displayName, findNode, pairNotes, parentOf } from '../lib/tree'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'

/**
 * The note pane's title in lecture mode: a menu of the notes that go with these slides, to
 * switch between them, link another note from the folder, make a new one or unlink one.
 */
export function NoteSwitcher({ path, title }: { path: string; title: string }): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const nodes = useApp((s) => s.nodes)
  const links = useApp((s) => s.links)
  const slides = useApp((s) => s.slidesFile)
  const { showNote, newNote, unlinkNote } = useApp.getState()

  function items(): MenuItem[] {
    if (!slides) return []
    const folder = childrenOf(nodes, parentOf(slides))
    const paired = pairNotes(folder, links).get(slides) ?? []
    // Notes linked from another folder are not shown under the PDF, but still belong here.
    const elsewhere = (links[slides] ?? [])
      .filter((p) => !paired.some((n) => n.path === p))
      .map((p) => findNode(nodes, p))
      .filter((n) => n !== null)
    const mine = [...paired, ...elsewhere]
    const others = folder.filter(
      (n) => n.kind === 'markdown' && !mine.some((m) => m.path === n.path)
    )
    const out: MenuItem[] = mine.map((n) => ({
      label: displayName(n),
      hint: n.path === path ? 'Open' : undefined,
      onSelect: () => void showNote(n.path)
    }))
    if (others.length) {
      out.push(
        { separator: true },
        { custom: <p className="menu-heading">Link a note from this folder</p> }
      )
      for (const n of others) {
        out.push({ label: displayName(n), onSelect: () => void showNote(n.path) })
      }
    }
    out.push(
      { separator: true },
      {
        custom: (
          <NewNoteField onCreate={(name) => void newNote(name)} onDone={() => setMenu(null)} />
        )
      }
    )
    if (links[slides]?.includes(path)) {
      out.push({ label: `Unlink ${title}`, onSelect: () => void unlinkNote(path) })
    }
    return out
  }

  return (
    <>
      <button
        className="pane-title note-switch"
        title="Notes for these slides"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.bottom + 2 })
        }}
      >
        <span>{title}</span>
        <Icon name="down" />
      </button>
      {menu && <ContextMenu {...menu} items={items()} onClose={() => setMenu(null)} />}
    </>
  )
}

function NewNoteField({
  onCreate,
  onDone
}: {
  onCreate(name: string): void
  onDone(): void
}): React.JSX.Element {
  const [name, setName] = useState('')
  return (
    <input
      className="menu-input"
      aria-label="New note"
      placeholder="New note..."
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' && name.trim()) {
          onCreate(name)
          onDone()
        } else if (e.key === 'Escape') {
          onDone()
        }
      }}
    />
  )
}
