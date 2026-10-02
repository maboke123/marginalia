import { memo, useEffect, useRef } from 'react'
import { AbortException, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'

interface Props {
  pdf: PDFDocumentProxy
  number: number
  width: number
  height: number
}

/**
 * Invisible PDF text on top of the page so it can be selected, copied and highlighted.
 * Laid out at scale 1 in page points; the overlay around it does the zooming.
 */
export const TextLayerView = memo(function TextLayerView({
  pdf,
  number,
  width,
  height
}: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = ref.current!
    let layer: TextLayer | null = null
    let cancelled = false

    pdf
      .getPage(number)
      .then((page) => {
        if (cancelled) return
        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container,
          viewport: page.getViewport({ scale: 1 })
        })
        return layer.render().then(() => {
          // Same trick as the pdf.js viewer: an element after the text that stretches over the
          // page while selecting, so dragging across empty space does not select everything.
          const end = document.createElement('div')
          end.className = 'endOfContent'
          container.append(end)
        })
      })
      .catch((err) => {
        if (!(err instanceof AbortException)) console.error(err)
      })

    return () => {
      cancelled = true
      layer?.cancel()
      container.replaceChildren()
    }
  }, [pdf, number])

  return (
    <div
      ref={ref}
      className="textLayer"
      data-page={number}
      data-width={width}
      style={{ width, height }}
      onPointerDown={(e) => {
        const layer = e.currentTarget
        layer.classList.add('selecting')
        window.addEventListener('pointerup', () => layer.classList.remove('selecting'), {
          once: true
        })
      }}
    />
  )
})
