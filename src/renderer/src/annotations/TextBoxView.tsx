import { memo, useEffect, useMemo, useRef } from 'react'
import type { TextBox } from '../../../shared/annotations'
import { renderMarkdown } from '../lib/markdown'

interface Props {
  box: TextBox
  selected: boolean
  editing: boolean
  interactive: boolean
  resizable: boolean
  onPointerDown(e: React.PointerEvent): void
  onDoubleClick(): void
  onResizeStart(e: React.PointerEvent): void
  /** Called once with the final text when editing ends. */
  onCommit(markdown: string): void
}

export const TextBoxView = memo(function TextBoxView(props: Props): React.JSX.Element {
  const { box, selected, editing, interactive, resizable } = props
  const html = useMemo(() => renderMarkdown(box.markdown), [box.markdown])

  const classes = ['text-box']
  if (box.author === 'claude') classes.push('by-claude')
  if (selected) classes.push('selected')
  if (editing) classes.push('editing')
  if (!interactive) classes.push('passive')

  return (
    <div
      className={classes.join(' ')}
      data-id={box.id}
      style={{ left: box.x, top: box.y, width: box.width, fontSize: box.fontSize }}
      onPointerDown={editing ? undefined : props.onPointerDown}
      onDoubleClick={editing ? undefined : props.onDoubleClick}
    >
      {editing ? (
        <Editor initial={box.markdown} onCommit={props.onCommit} />
      ) : (
        <div className="text-box-content" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {resizable && !editing && (
        <div
          className="text-box-resize"
          title="Drag to change the width"
          onPointerDown={props.onResizeStart}
        />
      )}
    </div>
  )
})

const FORMAT_KEYS: Record<string, [string, string]> = {
  b: ['**', '**'],
  i: ['*', '*'],
  u: ['<u>', '</u>']
}

/** Ctrl+B / Ctrl+I / Ctrl+U: puts Markdown markers around the selection, keeping native undo. */
function wrapSelection(el: HTMLTextAreaElement, before: string, after: string): void {
  const { selectionStart: start, selectionEnd: end, value } = el
  el.focus()
  // execCommand keeps Ctrl+Z working inside the text box, unlike setting value directly.
  document.execCommand('insertText', false, before + value.slice(start, end) + after)
  el.setSelectionRange(start + before.length, end + before.length)
}

function Editor({
  initial,
  onCommit
}: {
  initial: string
  onCommit(markdown: string): void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    const el = ref.current!
    grow(el)
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const finish = (value: string): void => {
    if (done.current) return
    done.current = true
    onCommit(value.trim())
  }

  return (
    <textarea
      ref={ref}
      className="text-box-editor"
      defaultValue={initial}
      placeholder="Markdown, $math$"
      spellCheck={false}
      onInput={(e) => grow(e.currentTarget)}
      onBlur={(e) => finish(e.currentTarget.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) e.currentTarget.blur()
        const wrap = e.ctrlKey && FORMAT_KEYS[e.key.toLowerCase()]
        if (wrap) {
          e.preventDefault()
          wrapSelection(e.currentTarget, ...wrap)
          grow(e.currentTarget)
        }
      }}
    />
  )
}
