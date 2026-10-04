import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ViewPage } from '../../../shared/blankPages'
import { useApp } from '../store'
import { pagesBetween, type Layout, type PageSize } from './layout'
import { renderRegion } from './snapshot'

interface Props {
  pdf: PDFDocumentProxy
  layout: Layout
  /** The pages in the viewer, blank pages included; `sizes` and `layout` follow them. */
  views: ViewPage[]
  sizes: PageSize[]
  scale: number
  contentWidth: number
}

type Box = { x: number; y: number; w: number; h: number }

/**
 * Covers the slides while taking a snapshot: drag a rectangle (or click for the whole slide)
 * and that part of the slide goes into the summary as an image.
 */
export function SnapshotLayer({
  pdf,
  layout,
  views,
  sizes,
  scale,
  contentWidth
}: Props): React.JSX.Element {
  const [drag, setDrag] = useState<{ start: [number, number]; box: Box } | null>(null)
  const setSnapshotting = useApp((s) => s.setSnapshotting)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSnapshotting(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSnapshotting])

  const local = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  async function finish(box: Box): Promise<void> {
    setSnapshotting(false)
    const [index] = pagesBetween(layout, box.y + box.h / 2, box.y + box.h / 2 + 1)
    const size = sizes[index]
    const pageLeft = (contentWidth - layout.widths[index]) / 2
    const toPoints = (px: number, origin: number): number => (px - origin) / scale
    const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
    // A click without dragging takes the whole slide.
    const whole = box.w < 6 && box.h < 6
    const x0 = whole ? 0 : clamp(toPoints(box.x, pageLeft), size.width)
    const y0 = whole ? 0 : clamp(toPoints(box.y, layout.tops[index]), size.height)
    const x1 = whole ? size.width : clamp(toPoints(box.x + box.w, pageLeft), size.width)
    const y1 = whole ? size.height : clamp(toPoints(box.y + box.h, layout.tops[index]), size.height)
    if (x1 - x0 < 2 || y1 - y0 < 2) return

    const { editor, showError } = useApp.getState()
    if (!editor) return
    const pdfPage = views[index].pdfPage
    if (pdfPage === null) {
      showError('A blank page has no slide to take a snapshot of')
      return
    }
    try {
      const png = await renderRegion(pdf, pdfPage, [x0, y0, x1 - x0, y1 - y0])
      const link = await window.api.vault.saveAsset(editor.path, png, 'png')
      editor.insert(`![](${link})\n`)
    } catch (err) {
      showError(`Snapshot failed: ${(err as Error).message}`)
    }
  }

  return (
    <div
      className="snapshot-layer"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const start = local(e)
        setDrag({ start, box: { x: start[0], y: start[1], w: 0, h: 0 } })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const [x, y] = local(e)
        const [sx, sy] = drag.start
        setDrag({
          start: drag.start,
          box: { x: Math.min(x, sx), y: Math.min(y, sy), w: Math.abs(x - sx), h: Math.abs(y - sy) }
        })
      }}
      onPointerUp={() => {
        if (drag) void finish(drag.box)
        setDrag(null)
      }}
    >
      {drag && (
        <div
          className="snapshot-box"
          style={{ left: drag.box.x, top: drag.box.y, width: drag.box.w, height: drag.box.h }}
        />
      )}
      <div className="snapshot-hint">
        Drag over the part of the slide to copy, or click for the whole slide. Esc cancels.
      </div>
    </div>
  )
}
