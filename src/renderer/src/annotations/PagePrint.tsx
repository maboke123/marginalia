import type { PageAnnotations } from '../../../shared/annotations'
import { DEFAULT_TEXT_SIZE, HIGHLIGHT_OPACITY, pageUnit } from '../../../shared/palette'
import { renderMarkdown } from '../lib/markdown'
import { strokePath } from './ink'

/**
 * One page with its annotations as the viewer draws it, without handles or text layer, in
 * PDF points. For printing a page that is not on screen.
 */
export function PagePrint({
  page,
  width,
  height,
  margin,
  slide,
  imageUrl
}: {
  page: PageAnnotations
  width: number
  height: number
  margin: number
  /** The slide drawn as an image; none for a blank page. */
  slide: string | null
  imageUrl(src: string): string
}): React.JSX.Element {
  const totalWidth = width * (1 + margin)
  const strokes = (tool: 'pen' | 'highlighter'): React.JSX.Element[] =>
    page.strokes
      .filter((s) => s.tool === tool)
      .map((s) => <path key={s.id} d={strokePath(s)} fill={s.color} />)
  return (
    <div className="pdf-page" style={{ width: totalWidth, height }}>
      <div className="pdf-sheet" style={{ width, height }}>
        {slide && <img src={slide} alt="" style={{ display: 'block', width, height }} />}
      </div>
      {margin > 0 && <div className="pdf-margin" style={{ width: width * margin, height }} />}
      <div
        className="page-overlay"
        style={{ width: totalWidth, height, fontSize: DEFAULT_TEXT_SIZE * pageUnit(width) }}
      >
        {page.highlights.map((h) =>
          h.rects.map(([x, y, w, rh], i) => (
            <div
              key={`${h.id}-${i}`}
              className={`hl ${h.style ?? 'highlight'}`}
              style={{
                left: x,
                top: y,
                width: w,
                height: rh,
                color: h.color,
                ['--line' as string]: `${Math.max(0.75, rh * 0.08)}px`
              }}
            />
          ))
        )}
        {page.images?.map((image) => (
          <div
            key={image.id}
            className="page-image passive"
            style={{ left: image.x, top: image.y, width: image.width, height: image.height }}
          >
            <img src={imageUrl(image.src)} alt="" />
          </div>
        ))}
        <svg className="ink" width={totalWidth} height={height}>
          <g className="highlighter" style={{ opacity: HIGHLIGHT_OPACITY }}>
            {strokes('highlighter')}
          </g>
          {strokes('pen')}
        </svg>
        {page.textBoxes.map((box) => (
          <div
            key={box.id}
            className="text-box passive"
            style={{
              left: box.x,
              top: box.y,
              width: box.width,
              fontSize: box.fontSize,
              color: box.color
            }}
          >
            <div
              className="text-box-content"
              style={{ maxHeight: Math.max(40, height - box.y - 8) }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(box.markdown) }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
