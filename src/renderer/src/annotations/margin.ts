import type { PageAnnotations, TextBox } from '../../../shared/annotations'
import { round } from './geometry'
import { pageUnit, TEXT_SIZES } from '../../../shared/palette'

/** Rough height of a rendered text box: wrapped lines at about half an em per character. */
export function estimateHeight(box: Pick<TextBox, 'markdown' | 'width'>, fontSize: number): number {
  const charsPerLine = Math.max(8, box.width / (fontSize * 0.5))
  const lines = box.markdown
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0)
  return lines * fontSize * 1.45 + fontSize
}

/**
 * Where a new note goes in the margin next to a page: full margin width, under the notes
 * already there, so Claude's notes do not cover mine.
 */
export function marginSlot(
  page: PageAnnotations,
  pageWidth: number,
  pageHeight: number,
  margin: number
): Pick<TextBox, 'x' | 'y' | 'width' | 'fontSize'> {
  const unit = pageUnit(pageWidth)
  const gap = 8 * unit
  const fontSize = round(TEXT_SIZES[1].value * unit)
  const width = round(Math.max(60 * unit, pageWidth * margin - 2 * gap))
  const bottoms = page.textBoxes
    .filter((box) => box.x >= pageWidth - gap)
    .map((box) => box.y + estimateHeight(box, box.fontSize ?? fontSize))
  const y = bottoms.length ? Math.max(...bottoms) + gap : gap
  return {
    x: round(pageWidth + gap),
    y: round(Math.min(y, pageHeight - 4 * fontSize)),
    width,
    fontSize
  }
}
