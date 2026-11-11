const UNIT = '  '

export interface IndentEdit {
  /** The whole lines touched and their new text. */
  from: number
  to: number
  insert: string
  /** The selection afterwards, moved along with the text. */
  select: [number, number]
}

/**
 * Tab / Shift+Tab in plain text: the lines of the selection (or the caret's line) get two
 * spaces more, or up to two less, like Tab in the note editor.
 */
export function indentLines(
  text: string,
  start: number,
  end: number,
  outdent: boolean
): IndentEdit {
  const from = text.lastIndexOf('\n', start - 1) + 1
  // A selection that ends at the start of a line does not take that line along.
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end
  const lineEnd = text.indexOf('\n', last)
  const to = lineEnd === -1 ? text.length : lineEnd
  const lines = text.slice(from, to).split('\n')
  const shifts = lines.map((line) =>
    outdent ? -Math.min(UNIT.length, line.length - line.trimStart().length) : UNIT.length
  )
  const map = (pos: number): number => {
    let lineStart = from
    let delta = 0
    for (let i = 0; i < lines.length; i++) {
      if (pos < lineStart) return pos + delta
      if (pos <= lineStart + lines[i].length) {
        // Inside the spaces that go, the position stays at the start of the line.
        return pos + delta + (outdent ? Math.max(shifts[i], lineStart - pos) : shifts[i])
      }
      delta += shifts[i]
      lineStart += lines[i].length + 1
    }
    return pos + delta
  }
  const insert = lines.map((line, i) => (outdent ? line.slice(-shifts[i]) : UNIT + line)).join('\n')
  return { from, to, insert, select: [map(start), map(end)] }
}

/** Tab in a textarea through the browser, so Ctrl+Z undoes it like typing. */
export function indentInTextarea(el: HTMLTextAreaElement, outdent: boolean): void {
  const edit = indentLines(el.value, el.selectionStart, el.selectionEnd, outdent)
  if (edit.insert === el.value.slice(edit.from, edit.to)) return
  el.setSelectionRange(edit.from, edit.to)
  document.execCommand('insertText', false, edit.insert)
  el.setSelectionRange(...edit.select)
}
