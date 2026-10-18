import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { boundsOf, type CanvasData } from '../../../shared/canvas'
import { drawDiagrams } from '../lib/diagrams'
import { appCss, escapeHtml } from '../lib/notePdf'
import { CanvasPrint } from './CanvasPrint'

const MARGIN = 40
// Chromium prints pages up to about 200 inches; a bigger canvas is scaled down to fit.
const MAX_PAGE = 14_000

const PRINT_CSS = `
body { margin: 0; font-family: var(--font); background: var(--bg); color: var(--text); }
.canvas-page { position: relative; overflow: hidden; --canvas-zoom: 1; }
.diagram-source { display: none; }
`

/** The whole canvas as one page of HTML, the size of what is on it, for printing to a PDF. */
export async function canvasHtml(path: string, data: CanvasData): Promise<string> {
  const bounds = boundsOf(data.nodes)
  if (!bounds) throw new Error('The canvas is empty')
  const width = bounds.width + MARGIN * 2
  const height = bounds.height + MARGIN * 2
  const scale = Math.min(1, MAX_PAGE / Math.max(width, height))
  const [pageWidth, pageHeight] = [Math.ceil(width * scale), Math.ceil(height * scale)]

  const root = document.createElement('div')
  root.className = 'canvas-page'
  root.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${pageWidth}px; height: ${pageHeight}px`
  root.innerHTML = renderToStaticMarkup(
    createElement(CanvasPrint, { data, bounds, margin: MARGIN, scale })
  )
  document.body.append(root)
  try {
    await drawDiagrams(root, 'paper')
    const title = path
      .split('/')
      .pop()!
      .replace(/\.canvas$/i, '')
    return (
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
      `<title>${escapeHtml(title)}</title>` +
      `<style>${appCss(/canvas-|\.diagram/)}\n${PRINT_CSS}\n` +
      `@page { size: ${pageWidth}px ${pageHeight}px; margin: 0; }\n` +
      `.canvas-page { width: ${pageWidth}px; height: ${pageHeight}px; }</style></head>` +
      `<body><div class="canvas-page">${root.innerHTML}</div></body></html>`
    )
  } finally {
    root.remove()
  }
}
