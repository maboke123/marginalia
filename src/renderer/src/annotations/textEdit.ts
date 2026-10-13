import { restyle } from '../../../shared/textStyle'

/** The text box being typed in, when part of its text is selected. */
export function editedSelection(): HTMLTextAreaElement | null {
  const el = document.activeElement
  return el instanceof HTMLTextAreaElement &&
    el.classList.contains('text-box-editor') &&
    el.selectionStart < el.selectionEnd
    ? el
    : null
}

/** Colours or sizes the selected text of the box being typed in, keeping native undo. */
export function restyleSelection(
  el: HTMLTextAreaElement,
  change: { color?: string | null; size?: number | null }
): void {
  const { value, selectionStart, selectionEnd } = el
  const result = restyle(value, selectionStart, selectionEnd, change)
  if (!result) return
  // Only the part that changed is replaced, so Ctrl+Z takes it back in one step.
  const next = result.text
  let start = 0
  while (start < value.length && value[start] === next[start]) start++
  let end = 0
  while (end < value.length - start && value.at(-1 - end) === next.at(-1 - end)) end++
  el.setSelectionRange(start, value.length - end)
  document.execCommand('insertText', false, next.slice(start, next.length - end))
  el.setSelectionRange(result.from, result.to)
}
