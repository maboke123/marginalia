import { memo, useEffect, useRef } from 'react'
import { RenderingCancelledException, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import { PageOverlay } from '../annotations/PageOverlay'
import type { PageSize } from './layout'

interface Props {
  pdf: PDFDocumentProxy
  path: string
  /** Page key: the PDF page number, or 3.1 for a blank page added after page 3. */
  number: number
  /** A page I added, with no PDF page to draw. */
  blank?: boolean
  size: PageSize
  margin: number
  top: number
  left: number
  scale: number
  /** Only pages near the viewport get a canvas; the rest are empty placeholders. */
  rendered: boolean
}

export const PdfPage = memo(function PdfPage(props: Props): React.JSX.Element {
  const { pdf, path, number, blank, size, margin, top, left, scale, rendered } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderedScale = useRef<number | null>(null)

  useEffect(() => {
    if (!rendered || blank) {
      renderedScale.current = null
      return
    }
    let task: RenderTask | null = null
    let cancelled = false

    async function draw(): Promise<void> {
      const page = await pdf.getPage(number)
      if (cancelled) return
      const viewport = page.getViewport({ scale: scale * window.devicePixelRatio })
      // Render off screen and copy when done, so the old image stays visible while zooming
      // instead of flashing white.
      const buffer = document.createElement('canvas')
      buffer.width = Math.floor(viewport.width)
      buffer.height = Math.floor(viewport.height)
      task = page.render({ canvas: buffer, viewport })
      await task.promise
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      canvas.width = buffer.width
      canvas.height = buffer.height
      canvas.getContext('2d')!.drawImage(buffer, 0, 0)
      renderedScale.current = scale
    }

    // While zooming, scale changes on every wheel step; only re-render once it settles.
    const delay = renderedScale.current === null ? 0 : 150
    const timer = setTimeout(() => {
      draw().catch((err) => {
        if (!(err instanceof RenderingCancelledException)) console.error(err)
      })
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
  }, [pdf, number, blank, scale, rendered])

  const sheetWidth = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)

  return (
    <div
      className={blank ? 'pdf-page blank' : 'pdf-page'}
      data-page={number}
      style={{ top, left, width: Math.round(size.width * (1 + margin) * scale), height }}
      aria-label={blank ? `Blank page after page ${Math.floor(number)}` : `Page ${number}`}
    >
      <div className="pdf-sheet" style={{ width: sheetWidth, height }}>
        {rendered && !blank && <canvas ref={canvasRef} />}
      </div>
      {margin > 0 && <div className="pdf-margin" style={{ left: sheetWidth, height }} />}
      {rendered && (
        <PageOverlay
          pdf={pdf}
          path={path}
          number={number}
          blank={blank}
          width={size.width}
          height={size.height}
          margin={margin}
          scale={scale}
        />
      )}
    </div>
  )
})
