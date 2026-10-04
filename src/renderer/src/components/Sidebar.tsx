import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NOTEBOOK_COLORS, type Position, type VaultNode } from '../../../shared/types'
import { draggingFiles, importDroppedFiles } from '../lib/drop'
import { childrenOf, displayOrder, isFolder, isWithin, visibleRows, type Row } from '../lib/tree'
import { useApp } from '../store'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import { TreeRow, type DropZone } from './TreeRow'

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface DropTarget {
  path: string
  zone: DropZone
}

export function Sidebar(): React.JSX.Element {
  const app = useApp()
  const { vault, nodes, expanded, selected, activeFile, renaming, colors, links } = app
  const rows = useMemo(() => visibleRows(nodes, expanded, links), [nodes, expanded, links])
  const treeRef = useRef<HTMLDivElement>(null)
  const dragged = useRef<VaultNode | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (!selected) return
    treeRef.current
      ?.querySelector(`[data-path="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function activate(row: Row): void {
    const { node } = row
    if (isFolder(node)) {
      app.select(node.path)
      app.setExpanded(node.path, !expanded[node.path])
    } else {
      app.openFile(node.path)
    }
  }

  function finishRename(path: string, name: string | null): void {
    if (name === null) app.startRename(null)
    else app.rename(path, name)
    treeRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    const index = rows.findIndex((r) => r.node.path === selected)
    const row = rows[index]
    const go = (i: number): void => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (target) app.select(target.node.path)
    }

    switch (e.key) {
      case 'ArrowDown':
        go(index + 1)
        break
      case 'ArrowUp':
        go(index === -1 ? rows.length - 1 : index - 1)
        break
      case 'ArrowRight':
        if (row && isFolder(row.node)) {
          if (!expanded[row.node.path]) app.setExpanded(row.node.path, true)
          else go(index + 1)
        }
        break
      case 'ArrowLeft':
        if (row && isFolder(row.node) && expanded[row.node.path]) {
          app.setExpanded(row.node.path, false)
        } else if (row?.parent) {
          app.select(row.parent)
        }
        break
      case 'Enter':
        if (row) activate(row)
        break
      case 'F2':
        if (row) app.startRename(row.node.path)
        break
      case 'Delete':
        if (row) app.trash(row.node.path)
        break
      default:
        return
    }
    e.preventDefault()
  }

  function menuFor(node: VaultNode): MenuItem[] {
    const items: MenuItem[] = []
    if (isFolder(node)) {
      items.push(
        {
          label: node.kind === 'notebook' ? 'New section' : 'New subsection',
          onSelect: () => app.create('section', node.path)
        },
        { label: 'New page', onSelect: () => app.create('page', node.path) },
        {
          label: 'Import PDF...',
          hint: app.settings.hotkeys.importPdf,
          onSelect: () => app.importPdfs(undefined, node.path)
        },
        { separator: true }
      )
    } else {
      items.push({ label: 'Open', onSelect: () => app.openFile(node.path) })
      if (node.kind === 'pdf') {
        items.push({ label: 'Export annotated PDF...', onSelect: () => app.exportPdf(node.path) })
      }
      items.push({ separator: true })
    }
    items.push({ label: 'Rename', hint: 'F2', onSelect: () => app.startRename(node.path) })
    if (node.kind === 'notebook') {
      items.push({ custom: <ColorPicker notebook={node.name} close={closeMenu} /> })
    }
    items.push(
      { label: 'Show in Explorer', onSelect: () => window.api.vault.reveal(node.path) },
      { separator: true },
      {
        label: 'Move to Recycle Bin',
        hint: 'Del',
        danger: true,
        onSelect: () => app.trash(node.path)
      }
    )
    return items
  }

  function openMenu(e: React.MouseEvent, items: MenuItem[]): void {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  function zoneFor(e: React.DragEvent, row: Row): DropZone {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    if (!isFolder(row.node)) return y < 0.5 ? 'before' : 'after'
    if (y < 0.25) return 'before'
    // Below an open folder, "after" would land visually between it and its first child.
    if (y > 0.75 && !expanded[row.node.path]) return 'after'
    return 'into'
  }

  function dropTarget(row: Row, zone: DropZone): { parent: string; before: Position } {
    if (zone === 'into') return { parent: row.node.path, before: undefined }
    // In the order shown, so dropping after a PDF lands below its note too.
    const siblings = displayOrder(childrenOf(nodes, row.parent), links)
    const i = siblings.findIndex((n) => n.path === row.node.path)
    const before = zone === 'before' ? row.node.name : (siblings[i + 1]?.name ?? null)
    return { parent: row.parent, before }
  }

  function canDrop(node: VaultNode, parent: string, before: Position): boolean {
    if (isFolder(node) && isWithin(parent, node.path)) return false
    if (!isFolder(node) && parent === '') return false
    return before !== node.name
  }

  function onDragOver(e: React.DragEvent, row: Row): void {
    const node = dragged.current
    if (!node) {
      // PDFs dragged in from Explorer can be dropped on a notebook or section.
      if (!draggingFiles(e)) return
      if (!isFolder(row.node)) {
        setDrop(null)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
      if (drop?.path !== row.node.path) setDrop({ path: row.node.path, zone: 'into' })
      return
    }
    const zone = zoneFor(e, row)
    const { parent, before } = dropTarget(row, zone)
    if (!canDrop(node, parent, before)) {
      setDrop(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (drop?.path !== row.node.path || drop.zone !== zone) setDrop({ path: row.node.path, zone })
  }

  function onDrop(e: React.DragEvent, row: Row): void {
    const node = dragged.current
    e.preventDefault()
    e.stopPropagation()
    setDrop(null)
    if (!node) {
      if (draggingFiles(e) && isFolder(row.node)) importDroppedFiles(e, row.node.path)
      return
    }
    const { parent, before } = dropTarget(row, zoneFor(e, row))
    if (canDrop(node, parent, before)) app.move(node.path, parent, before)
  }

  if (!vault) return <aside className="sidebar" />

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <button
          className="vault-switcher"
          title={vault.root}
          onClick={(e) => openMenu(e, vaultMenu(app.recent, vault.root, app.openVault))}
        >
          <Icon name="vault" />
          <span className="tree-label">{vault.name}</span>
        </button>
        <button
          className="icon-button"
          title={`Search everything (${app.settings.hotkeys.search})`}
          aria-label="Search everything"
          onClick={() => app.setOverlay('search')}
        >
          <Icon name="search" />
        </button>
        <button
          className="icon-button"
          title={`Import PDF (${app.settings.hotkeys.importPdf})`}
          aria-label="Import PDF"
          onClick={() => app.importPdfs()}
        >
          <Icon name="import" />
        </button>
        <button
          className="icon-button"
          title={`Settings (${app.settings.hotkeys.settings})`}
          aria-label="Settings"
          onClick={() => app.setOverlay('settings')}
        >
          <Icon name="settings" />
        </button>
        <button
          className="icon-button"
          title="New notebook"
          aria-label="New notebook"
          onClick={() => app.create('notebook', '')}
        >
          <Icon name="plus" />
        </button>
      </header>

      <div
        ref={treeRef}
        className="tree"
        role="tree"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
        }}
        onContextMenu={(e) =>
          openMenu(e, [{ label: 'New notebook', onSelect: () => app.create('notebook', '') }])
        }
      >
        {rows.map((row) => (
          <TreeRow
            key={row.node.path}
            row={row}
            expanded={!!expanded[row.node.path]}
            selected={selected === row.node.path}
            active={activeFile === row.node.path}
            renaming={renaming === row.node.path}
            color={row.node.kind === 'notebook' ? colors[row.node.name] : undefined}
            dropZone={drop?.path === row.node.path ? drop.zone : null}
            onClick={() => activate(row)}
            onContextMenu={(e) => {
              app.select(row.node.path)
              openMenu(e, menuFor(row.node))
            }}
            onRename={(name) => finishRename(row.node.path, name)}
            onDragStart={(e) => {
              dragged.current = row.node
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', row.node.path)
            }}
            onDragOver={(e) => onDragOver(e, row)}
            onDrop={(e) => onDrop(e, row)}
            onDragEnd={() => {
              dragged.current = null
              setDrop(null)
            }}
          />
        ))}

        {rows.length === 0 && (
          <div className="tree-empty">
            <p>No notebooks yet. A notebook is a folder for one course.</p>
            <button className="button" onClick={() => app.create('notebook', '')}>
              New notebook
            </button>
          </div>
        )}
      </div>

      {menu && <ContextMenu {...menu} onClose={closeMenu} />}
    </aside>
  )
}

function vaultMenu(
  recent: string[],
  current: string,
  open: (root?: string) => Promise<void>
): MenuItem[] {
  const others = recent.filter((p) => p !== current)
  const items: MenuItem[] = others.map((p) => ({
    label: p.split(/[\\/]/).pop() ?? p,
    hint: p,
    onSelect: () => open(p)
  }))
  if (items.length) items.push({ separator: true })
  items.push({ label: 'Open folder...', onSelect: () => open() })
  return items
}

function ColorPicker({ notebook, close }: { notebook: string; close(): void }): React.JSX.Element {
  const current = useApp((s) => s.colors[notebook])
  const setColor = useApp((s) => s.setColor)
  const pick = (color: (typeof NOTEBOOK_COLORS)[number] | null): void => {
    close()
    setColor(notebook, color)
  }
  return (
    <div className="menu-swatches" aria-label="Notebook colour">
      {NOTEBOOK_COLORS.map((c) => (
        <button
          key={c}
          className="swatch"
          title={c}
          aria-label={c}
          aria-pressed={current === c}
          style={{ background: `var(--nb-${c})` }}
          onClick={() => pick(c)}
        />
      ))}
      <button
        className="swatch none"
        title="No colour"
        aria-label="No colour"
        onClick={() => pick(null)}
      />
    </div>
  )
}
