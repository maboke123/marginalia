import type { Highlight } from '../../../shared/annotations'
import { newId } from './doc'
import { mergeLineRects, type Rect } from './geometry'

/** The PDF text layer the current text selection starts in, if any. */
export function selectedTextLayer(): HTMLElement | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const node = selection.getRangeAt(0).startContainer
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>('.textLayer') ?? null
}

/**
 * Turns the selected PDF text into a highlight in page points. A selection that runs over
 * several pages is cut off at the end of the page where it starts.
 */
export function highlightFromSelection(
  color: string
): { page: number; highlight: Highlight } | null {
  const layer = selectedTextLayer()
  const selection = window.getSelection()
  if (!layer || !selection) return null

  const box = layer.getBoundingClientRect()
  const scale = box.width / Number(layer.dataset.width)
  const rects: Rect[] = [...selection.getRangeAt(0).getClientRects()]
    .filter(
      (r) =>
        r.width > 1 &&
        r.height > 1 &&
        // The stretched end-of-content element is part of the range but is not text.
        r.height < box.height / 2 &&
        r.left >= box.left - 1 &&
        r.right <= box.right + 1 &&
        r.top >= box.top - 1 &&
        r.bottom <= box.bottom + 1
    )
    .map((r) => [
      (r.left - box.left) / scale,
      (r.top - box.top) / scale,
      r.width / scale,
      r.height / scale
    ])
  if (!rects.length) return null

  return {
    page: Number(layer.dataset.page),
    highlight: {
      id: newId('h'),
      color,
      text: selection.toString().replace(/\s+/g, ' ').trim(),
      rects: mergeLineRects(rects),
      author: 'me'
    }
  }
}
