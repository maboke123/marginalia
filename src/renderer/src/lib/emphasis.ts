/** `**` for bold, `*` for italic. */
export type Mark = '**' | '*'

export interface MarkEdit {
  /** The range to replace and its new text. */
  from: number
  to: number
  insert: string
  /** The selection afterwards: the same words. */
  select: [number, number]
}

const starsBefore = (text: string, at: number): number => {
  let n = 0
  while (at - n > 0 && text[at - n - 1] === '*') n++
  return n
}

const starsAfter = (text: string, at: number): number => {
  let n = 0
  while (at + n < text.length && text[at + n] === '*') n++
  return n
}

// Bold is on with 2 or 3 stars around (3 is bold and italic); italic with an odd number.
const isOn = (mark: Mark, before: number, after: number): boolean =>
  mark === '**'
    ? before >= 2 && after >= 2 && before <= 3 && after <= 3
    : before % 2 === 1 && after % 2 === 1

/**
 * Ctrl+B / Ctrl+I on the selection in Markdown text: wraps it in the mark, or takes the mark
 * away when it is already there (around the selection or as its first and last characters).
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): MarkEdit {
  // Double-click on Windows selects the space after a word too.
  let from = start
  let to = end
  while (from < to && /\s/.test(text[from])) from++
  while (to > from && /\s/.test(text[to - 1])) to--
  const m = mark.length
  if (isOn(mark, starsBefore(text, from), starsAfter(text, to))) {
    return {
      from: from - m,
      to: to + m,
      insert: text.slice(from, to),
      select: [from - m, to - m]
    }
  }
  const inner = text.slice(from, to)
  const lead = starsAfter(inner, 0)
  const trail = starsBefore(inner, inner.length)
  if (inner.length > 2 * m && isOn(mark, lead, trail)) {
    const plain = inner.slice(m, inner.length - m)
    return { from, to, insert: plain, select: [from, from + plain.length] }
  }
  return {
    from,
    to,
    insert: mark + inner + mark,
    select: [from + m, to + m]
  }
}

/** Applies the mark in a textarea through the browser, so Ctrl+Z undoes it like typing. */
export function markInTextarea(el: HTMLTextAreaElement, mark: Mark): void {
  const edit = toggleMark(el.value, el.selectionStart, el.selectionEnd, mark)
  el.focus()
  el.setSelectionRange(edit.from, edit.to)
  if (edit.insert) document.execCommand('insertText', false, edit.insert)
  else document.execCommand('delete')
  el.setSelectionRange(...edit.select)
}

/** The mark for a key press, or null: Ctrl+B and Ctrl+I without Shift or Alt. */
export function markOfKey(e: {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}): Mark | null {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return null
  const key = e.key.toLowerCase()
  return key === 'b' ? '**' : key === 'i' ? '*' : null
}
