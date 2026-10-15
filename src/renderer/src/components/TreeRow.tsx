import { useEffect, useRef } from 'react'
import type { NotebookColor, VaultNode } from '../../../shared/types'
import { displayName, isFolder, type Row } from '../lib/tree'
import { Icon, type IconName } from './Icon'

export type DropZone = 'before' | 'after' | 'into'

const ICONS: Record<VaultNode['kind'], IconName> = {
  notebook: 'notebook',
  section: 'folder',
  markdown: 'page',
  pdf: 'pdf'
}

interface Props {
  row: Row
  expanded: boolean
  transcriptsShown: boolean
  onToggleTranscripts(): void
  selected: boolean
  active: boolean
  renaming: boolean
  color?: NotebookColor
  dropZone: DropZone | null
  onClick(): void
  onContextMenu(e: React.MouseEvent): void
  onRename(name: string | null): void
  onDragStart(e: React.DragEvent): void
  onDragOver(e: React.DragEvent): void
  onDrop(e: React.DragEvent): void
  onDragEnd(): void
}

export function TreeRow(props: Props): React.JSX.Element {
  const { row, expanded, selected, active, renaming, color, dropZone } = props
  const { node, depth } = row
  const folder = isFolder(node)

  const classes = ['tree-row']
  if (selected) classes.push('selected')
  if (active) classes.push('active')
  if (dropZone) classes.push(`drop-${dropZone}`)
  if (row.pairedWith) classes.push('paired')

  return (
    <div
      className={classes.join(' ')}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={folder ? expanded : undefined}
      data-path={node.path}
      title={row.pairedWith ? `Note for ${row.pairedWith.split('/').pop()}` : undefined}
      style={{ paddingLeft: 8 + depth * 16, ['--depth' as string]: depth }}
      draggable={!renaming}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      {row.pairedWith && <span className="tree-pair-line" aria-hidden />}
      <span className={expanded ? 'tree-chevron open' : 'tree-chevron'}>
        {folder && node.children!.length > 0 && <Icon name="chevron" />}
      </span>
      <span className="tree-icon" style={color ? { color: `var(--nb-${color})` } : undefined}>
        <Icon name={ICONS[node.kind]} />
      </span>
      {renaming ? (
        <RenameInput node={node} onDone={props.onRename} />
      ) : (
        <span className="tree-label">{displayName(node)}</span>
      )}
      {!!row.transcripts && !renaming && (
        <button
          className={props.transcriptsShown ? 'tree-transcripts pressed' : 'tree-transcripts'}
          title={`${props.transcriptsShown ? 'Hide' : 'Show'} ${row.transcripts} transcript${row.transcripts === 1 ? '' : 's'}`}
          aria-label="Transcripts"
          aria-pressed={props.transcriptsShown}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation()
            props.onToggleTranscripts()
          }}
        >
          <Icon name="mic" />
          {row.transcripts}
        </button>
      )}
    </div>
  )
}

function RenameInput({
  node,
  onDone
}: {
  node: VaultNode
  onDone(name: string | null): void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  const initial = displayName(node)

  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    // Like Explorer: select the name but not the extension.
    const dot = node.kind === 'pdf' ? initial.lastIndexOf('.') : -1
    input.setSelectionRange(0, dot > 0 ? dot : initial.length)
  }, [initial, node.kind])

  function finish(value: string | null): void {
    if (finished.current) return
    finished.current = true
    onDone(value)
  }

  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}
