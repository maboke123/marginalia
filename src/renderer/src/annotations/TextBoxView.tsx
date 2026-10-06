import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TextBox } from '../../../shared/annotations'
import { Cancelled, cancelWrite, findRequest, newRequestId, writeWithClaude } from '../claude/write'
import { mapPosition, planWrite, type WriteAnswer } from '../claude/writePlan'
import { RenderedHtml } from '../components/RenderedHtml'
import { renderMarkdown } from '../lib/markdown'
import { useApp } from '../store'

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
  /** Page the box is on, sent to Claude with a /claude request. */
  page: number
  /** A /claude answer that arrived after editing ended: replace `original` in the box. */
  onLateAnswer(original: string, answer: WriteAnswer): void
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
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        fontSize: box.fontSize,
        color: box.color
      }}
      onPointerDown={editing ? undefined : props.onPointerDown}
      onDoubleClick={editing ? undefined : props.onDoubleClick}
    >
      {editing ? (
        <Editor
          initial={box.markdown}
          page={props.page}
          onCommit={props.onCommit}
          onLateAnswer={props.onLateAnswer}
        />
      ) : (
        <RenderedHtml className="text-box-content" html={html} surface="paper" />
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

/**
 * Makes Claude's changes in the box being typed in, keeping my cursor and the box's own undo.
 * Returns the edits it could not find, or null when the request itself is gone.
 */
function applyInEditor(
  el: HTMLTextAreaElement,
  original: string,
  answer: WriteAnswer
): string[] | null {
  const at = el.value.indexOf(original)
  if (at === -1) return null
  const { changes, missing } = planWrite(el.value, { from: at, to: at + original.length }, answer)
  const [start, end] = [el.selectionStart, el.selectionEnd]
  el.focus()
  // Last change first, so the positions of the earlier ones stay valid.
  for (const c of [...changes].reverse()) {
    el.setSelectionRange(c.from, c.to)
    document.execCommand(c.insert ? 'insertText' : 'delete', false, c.insert)
  }
  el.setSelectionRange(mapPosition(start, changes), mapPosition(end, changes))
  return missing
}

function Editor({
  initial,
  page,
  onCommit,
  onLateAnswer
}: {
  initial: string
  page: number
  onCommit(markdown: string): void
  onLateAnswer(original: string, answer: WriteAnswer): void
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const [writing, setWriting] = useState<string[]>([])

  /** "/claude ..." + Enter in a text box: the slide it is on goes along. */
  const ask = (value: string, from: number, to: number, question: string): void => {
    const id = newRequestId()
    const original = value.slice(from, to)
    const pdf = useApp.getState().pdfView?.path
    setWriting((w) => [...w, id])
    writeWithClaude({
      id,
      where: `a text box on page ${page}${pdf ? ` of ${pdf}` : ''}, my note on that slide`,
      around: value.slice(0, from) + '⟦here⟧' + value.slice(to),
      ask: question,
      slide: pdf ? { path: pdf, page } : undefined
    })
      .then((answer) => {
        const el = ref.current
        if (el && !done.current) {
          const missing = applyInEditor(el, original, answer)
          if (!missing) {
            useApp.getState().showError('The /claude request was changed; nothing was inserted')
          } else if (missing.length) {
            useApp.getState().showError('Claude wanted to change text that is not in this box')
          }
          grow(el)
        } else {
          onLateAnswer(original, answer)
        }
      })
      .catch((err) => {
        if (!(err instanceof Cancelled)) {
          useApp.getState().showError(`Claude could not write here: ${(err as Error).message}`)
        }
      })
      .finally(() => setWriting((w) => w.filter((x) => x !== id)))
  }

  /** Enter at the end of a line with a request sends it. */
  const onEnter = (el: HTMLTextAreaElement): boolean => {
    const { value, selectionStart: pos, selectionEnd } = el
    if (pos !== selectionEnd) return false
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1
    const lineEnd = value.indexOf('\n', pos) === -1 ? value.length : value.indexOf('\n', pos)
    if (pos !== lineEnd) return false
    const found = findRequest(value.slice(lineStart, lineEnd))
    if (!found) return false
    ask(value, lineStart + found.at, lineEnd, found.ask)
    // Go on to a new line, so I can keep writing while Claude works.
    document.execCommand('insertText', false, '\n')
    grow(el)
    return true
  }

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

  const commit = useRef(onCommit)
  useLayoutEffect(() => {
    commit.current = onCommit
  })

  const finish = (value: string): void => {
    if (done.current) return
    done.current = true
    commit.current(value.trim())
  }

  // Scrolling far away or opening another file removes the box without a blur. A layout
  // cleanup runs before the viewer's save on unmount, so the text is part of that save.
  useLayoutEffect(() => {
    const el = ref.current!
    return () => finish(el.value)
  }, [])

  return (
    <>
      <textarea
        ref={ref}
        className="text-box-editor"
        defaultValue={initial}
        placeholder="Markdown, $math$, /claude"
        spellCheck={false}
        onInput={(e) => grow(e.currentTarget)}
        onBlur={(e) => finish(e.currentTarget.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' && writing.length) {
            e.preventDefault()
            cancelWrite(writing[writing.length - 1])
            return
          }
          if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && onEnter(e.currentTarget)) {
            e.preventDefault()
            return
          }
          if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey)) e.currentTarget.blur()
          const wrap = e.ctrlKey && FORMAT_KEYS[e.key.toLowerCase()]
          if (wrap) {
            e.preventDefault()
            wrapSelection(e.currentTarget, ...wrap)
            grow(e.currentTarget)
          }
        }}
      />
      {writing.length > 0 && (
        <div className="text-box-claude" onPointerDown={(e) => e.preventDefault()}>
          Claude is writing...
          <button onClick={() => writing.forEach(cancelWrite)}>Cancel</button>
        </div>
      )}
    </>
  )
}
