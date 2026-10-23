import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PageAnnotations } from '../../../shared/annotations'
import { isBlankPage, slideOf } from '../../../shared/blankPages'
import { vaultUrl } from '../editor/links'
import { drawDiagrams } from '../lib/diagrams'
import { appCss } from '../lib/notePdf'
import { renderPage } from '../pdf/snapshot'
import { imagePath } from './images'
import { PagePrint } from './PagePrint'

const PRINT_CSS = `
body { margin: 0; font-family: var(--font); }
.pdf-page { left: 0; top: 0; overflow: hidden; }
.diagram-source { display: none; }
`

const dataUrl = (png: Uint8Array): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(new Blob([png as BlobPart], { type: 'image/png' }))
  })

/**
 * A page of a PDF (or a blank page under a slide) with its annotations as one page of HTML,
 * for printing to a PDF: text boxes keep their formulas, colours and charts, like on screen.
 */
export async function pageHtml(
  path: string,
  pdf: PDFDocumentProxy,
  key: number,
  page: PageAnnotations,
  margin: number
): Promise<string> {
  const { width, height } = (await pdf.getPage(slideOf(key))).getViewport({ scale: 1 })
  // Twice the page size in pixels, so slide text stays sharp in the picture.
  const slide = isBlankPage(key)
    ? null
    : await dataUrl(await renderPage(pdf, slideOf(key), 2 * Math.max(width, height)))
  const totalWidth = Math.ceil(width * (1 + margin))
  const pageHeight = Math.ceil(height)

  const root = document.createElement('div')
  root.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${totalWidth}px`
  root.innerHTML = renderToStaticMarkup(
    createElement(PagePrint, {
      page,
      width,
      height,
      margin,
      slide,
      imageUrl: (src) => vaultUrl(imagePath(path, src))
    })
  )
  document.body.append(root)
  try {
    await drawDiagrams(root, 'paper')
    return (
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
      `<style>${appCss(/pdf-page|pdf-sheet|pdf-margin|page-overlay|\.hl|\.ink|text-box|page-image|\.diagram/)}\n` +
      `${PRINT_CSS}\n@page { size: ${totalWidth}px ${pageHeight}px; margin: 0; }</style></head>` +
      `<body>${root.innerHTML}</body></html>`
    )
  } finally {
    root.remove()
  }
}
