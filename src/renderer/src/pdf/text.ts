import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { TextRun } from '../annotations/findText'

async function textItems(pdf: PDFDocumentProxy, pageNumber: number): Promise<TextItem[]> {
  const content = await (await pdf.getPage(pageNumber)).getTextContent()
  return content.items.filter((item): item is TextItem => 'str' in item)
}

/** The text of a page in reading order, one line per line of the slide. */
export async function pageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const items = await textItems(pdf, pageNumber)
  return items
    .map((item) => item.str + (item.hasEOL ? '\n' : ''))
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Text runs with their boxes in page points from the top-left, for finding text to highlight. */
export async function pageRuns(pdf: PDFDocumentProxy, pageNumber: number): Promise<TextRun[]> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  return (await textItems(pdf, pageNumber))
    .filter((item) => item.str.trim())
    .map((item) => {
      const [, , c, d, e, f] = item.transform
      const height = Math.hypot(c, d) || item.height
      const [x, baseline] = viewport.convertToViewportPoint(e, f)
      // pdf.js puts the top of a line about 0.8 font sizes above the baseline, like its text layer.
      return { str: item.str, x, y: baseline - 0.8 * height, width: item.width, height }
    })
}
