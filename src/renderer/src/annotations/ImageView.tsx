import { memo, useState } from 'react'
import type { PageImage } from '../../../shared/annotations'

interface Props {
  image: PageImage
  url: string
  selected: boolean
  /** Only in select mode; with a drawing tool, ink goes over the image. */
  interactive: boolean
  onPointerDown(e: React.PointerEvent): void
  onResizeStart(e: React.PointerEvent): void
}

export const ImageView = memo(function ImageView(props: Props): React.JSX.Element {
  const { image, selected, interactive } = props
  const [missing, setMissing] = useState(false)

  const classes = ['page-image']
  if (selected) classes.push('selected')
  if (!interactive) classes.push('passive')

  return (
    <div
      className={classes.join(' ')}
      data-id={image.id}
      style={{ left: image.x, top: image.y, width: image.width, height: image.height }}
      onPointerDown={props.onPointerDown}
    >
      {missing ? (
        <span className="page-image-missing">Image not found: {image.src}</span>
      ) : (
        <img src={props.url} alt="" draggable={false} onError={() => setMissing(true)} />
      )}
      {interactive && (
        <div
          className="page-image-resize"
          title="Drag to resize"
          onPointerDown={props.onResizeStart}
        />
      )}
    </div>
  )
})
