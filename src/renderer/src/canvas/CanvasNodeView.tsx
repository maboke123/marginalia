import { memo, useEffect, useMemo, useRef } from 'react'
import {
  compartments,
  cssColor,
  type CanvasNode,
  type InkNode,
  type TextNode
} from '../../../shared/canvas'
import { strokeOutline } from '../../../shared/ink'
import { RenderedHtml } from '../components/RenderedHtml'
import { Icon } from '../components/Icon'
import { vaultUrl } from '../editor/links'
import { renderMarkdown } from '../lib/markdown'
import type { Handle } from './ops'
import { editHint } from './shapes'

const HANDLES: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
const SIDES = ['top', 'right', 'bottom', 'left'] as const
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i

interface Props {
  node: CanvasNode
  selected: boolean
  /** Only one box shows its handles: with several chosen, they move together. */
  handles: boolean
  editing: boolean
  /** Just added from the shapes: typing replaces its placeholder name. */
  fresh?: boolean
  /** 'ghost': proposed by Claude; 'removed': Claude proposes to remove it. */
  proposal?: 'ghost' | 'removed'
  onText(text: string): void
  onDone(): void
}

function Markdown({ text, className }: { text: string; className: string }): React.JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <RenderedHtml className={className} html={html} surface="app" />
}

// UML visibility (- private, + public, # protected, ~ package) would start a Markdown list.
const literalVisibility = (part: string): string =>
  part.replace(/^(\s*)([-+#~])(?=\s|\w)/gm, '$1\\$2')

function ClassBox({ text }: { text: string }): React.JSX.Element {
  const [name, ...rest] = compartments(text)
  return (
    <div className="canvas-class">
      <Markdown text={name || ' '} className="canvas-class-name canvas-md" />
      {rest.map((part, i) => (
        <Markdown
          key={i}
          text={literalVisibility(part) || ' '}
          className="canvas-class-part canvas-md"
        />
      ))}
    </div>
  )
}

function Actor({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="canvas-actor">
      <svg viewBox="0 0 40 60" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <circle cx="20" cy="9" r="7" />
        <path d="M20 16v22M6 25h28M20 38l-12 18M20 38l12 18" />
      </svg>
      <Markdown text={text} className="canvas-actor-name canvas-md" />
    </div>
  )
}

function TextContent({ node }: { node: TextNode }): React.JSX.Element | null {
  switch (node.shape) {
    case 'class':
      return <ClassBox text={node.text} />
    case 'actor':
      return <Actor text={node.text} />
    case 'initial':
    case 'final':
      return null
    case 'diamond':
      return (
        <>
          <svg className="canvas-diamond" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points="50,1 99,50 50,99 1,50" vectorEffect="non-scaling-stroke" />
          </svg>
          <Markdown text={node.text} className="canvas-md canvas-centered" />
        </>
      )
    default: {
      const centered = node.shape === 'ellipse' || node.shape === 'circle'
      return (
        <Markdown
          text={node.text}
          className={centered ? 'canvas-md canvas-centered' : 'canvas-md'}
        />
      )
    }
  }
}

const FOLD = 18

/**
 * A note's paper with a folded corner, drawn instead of cut out: a clip-path also cut away
 * the outline that shows a note is selected.
 */
function NoteBody({ width, height }: { width: number; height: number }): React.JSX.Element {
  const w = Math.max(width, FOLD)
  return (
    <svg className="canvas-note-body" width={width} height={height} aria-hidden>
      <path d={`M0.75,0.75 H${w - FOLD} L${w - 0.75},${FOLD} V${height - 0.75} H0.75 Z`} />
      <path className="fold" d={`M${w - FOLD},0.75 V${FOLD} H${w - 0.75}`} />
    </svg>
  )
}

function Ink({ node }: { node: InkNode }): React.JSX.Element {
  return (
    <svg className="canvas-ink" width={node.width} height={node.height} aria-hidden>
      {node.strokes.map((s, i) => (
        <path
          key={i}
          d={strokeOutline({ id: '', tool: 'pen', author: 'me', ...s })}
          fill={s.color}
        />
      ))}
    </svg>
  )
}

function FileContent({ file }: { file: string }): React.JSX.Element {
  if (IMAGE.test(file)) {
    return <img className="canvas-image" src={vaultUrl(file)} alt="" draggable={false} />
  }
  const name = file.split('/').pop() ?? file
  return (
    <div className="canvas-card">
      <Icon name={/\.pdf$/i.test(file) ? 'pdf' : /\.canvas$/i.test(file) ? 'canvas' : 'page'} />
      <span>{name.replace(/\.(md|canvas)$/i, '')}</span>
      <span className="muted">Double-click to open</span>
    </div>
  )
}

/** The text of a box being typed, in a textarea that fills the box. */
function Editor({
  value,
  shape,
  fresh,
  onText,
  onDone
}: {
  value: string
  shape: string | undefined
  /** A shape just added: its first line (the placeholder name) is selected, to type over. */
  fresh: boolean
  onText(text: string): void
  onDone(): void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current!
    el.focus()
    const firstLine = el.value.split('\n')[0].length
    if (fresh && firstLine) el.setSelectionRange(0, firstLine)
    else el.setSelectionRange(el.value.length, el.value.length)
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <>
      <span className="canvas-edit-hint">{editHint(shape)}</span>
      <textarea
        ref={ref}
        className="canvas-editor"
        value={value}
        spellCheck
        onChange={(e) => onText(e.target.value)}
        onBlur={onDone}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) e.currentTarget.blur()
        }}
      />
    </>
  )
}

/** One box of the canvas, positioned in world units inside the scaled layer. */
export const CanvasNodeView = memo(function CanvasNodeView({
  node,
  selected,
  handles,
  editing,
  fresh = false,
  proposal,
  onText,
  onDone
}: Props): React.JSX.Element {
  const color = cssColor(node.color)
  const shape = node.type === 'text' ? (node.shape ?? 'rectangle') : node.type
  const className = [
    'canvas-node',
    `canvas-${node.type}`,
    `shape-${shape}`,
    color ? 'colored' : '',
    selected ? 'selected' : '',
    proposal ?? ''
  ]
    .filter(Boolean)
    .join(' ')
  const style = {
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    ...(color ? { '--node-color': color } : {})
  } as React.CSSProperties

  let content: React.ReactNode
  if (node.type === 'text') {
    content = editing ? (
      <Editor value={node.text} shape={node.shape} fresh={fresh} onText={onText} onDone={onDone} />
    ) : (
      <TextContent node={node} />
    )
  } else if (node.type === 'group') {
    content = editing ? (
      <input
        className="canvas-group-label editing"
        autoFocus
        value={node.label ?? ''}
        onChange={(e) => onText(e.target.value)}
        onBlur={onDone}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
        }}
      />
    ) : (
      <span className="canvas-group-label">{node.label || 'Group'}</span>
    )
  } else if (node.type === 'file') {
    content = <FileContent file={node.file} />
  } else if (node.type === 'link') {
    content = (
      <div className="canvas-card">
        <span>{node.url}</span>
        <span className="muted">Double-click to open</span>
      </div>
    )
  } else if (node.type === 'ink') {
    content = <Ink node={node} />
  }

  return (
    <div className={className} style={style} data-node={node.id}>
      {node.type === 'text' && node.shape === 'note' && (
        <NoteBody width={node.width} height={node.height} />
      )}
      {content}
      {handles && !editing && (
        <>
          {HANDLES.map((h) => (
            <span key={h} className={`canvas-handle h-${h}`} data-handle={h} />
          ))}
          {node.type !== 'group' &&
            SIDES.map((side) => (
              <span
                key={side}
                className={`canvas-connect c-${side}`}
                data-connect={side}
                title="Drag to another box to connect them"
              />
            ))}
        </>
      )}
    </div>
  )
})
