import type { PageImage } from '../../../shared/annotations'
import { useApp } from '../store'
import { addItem, newId, pageOf, type AnnotationDoc } from './doc'
import type { Point } from './geometry'
import { PAGE_IMAGE_TYPES, placeImage } from './images'

export interface ImageTarget {
  page: number
  width: number
  height: number
  margin: number
  /** Where I clicked or dropped, in page points; null puts the image in the margin. */
  at: Point | null
}

const lastClicks = new WeakMap<AnnotationDoc, { page: number; point: Point }>()

/** Remembers where I last clicked on a page, so a pasted screenshot can go there. */
export function rememberClick(doc: AnnotationDoc, page: number, point: Point): void {
  lastClicks.set(doc, { page, point })
}

export function lastClick(doc: AnnotationDoc): { page: number; point: Point } | undefined {
  return lastClicks.get(doc)
}

async function naturalSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/**
 * Saves image files into the assets folder next to the PDF and puts them on a page as one
 * undo step, stacked under each other. Selects the last one so it can be moved straight away.
 */
export async function addImageFiles(
  doc: AnnotationDoc,
  pdf: string,
  files: File[],
  target: ImageTarget
): Promise<void> {
  const { showError } = useApp.getState()
  const usable = files.filter((f) => PAGE_IMAGE_TYPES[f.type])
  const skipped = files.filter((f) => !PAGE_IMAGE_TYPES[f.type]).map((f) => f.name || f.type)
  if (skipped.length) {
    showError(`Only PNG and JPEG images can go on a slide. Skipped: ${skipped.join(', ')}`)
  }
  if (!usable.length) return
  try {
    const images: PageImage[] = []
    let at = target.at
    for (const file of usable) {
      const [size, src] = await Promise.all([
        naturalSize(file),
        window.api.vault.saveAsset(
          pdf,
          new Uint8Array(await file.arrayBuffer()),
          PAGE_IMAGE_TYPES[file.type]
        )
      ])
      const current = images.reduce(
        (pages, im) => addItem(pages, target.page, 'images', im),
        doc.getState().pages
      )
      const place = placeImage(size, target, pageOf(current, target.page), at)
      images.push({ id: newId('i'), ...place, src, author: 'me' })
      if (at) at = [at[0], place.y + place.height + 4]
    }
    doc
      .getState()
      .change((pages) => images.reduce((p, im) => addItem(p, target.page, 'images', im), pages))
    doc.getState().select({ page: target.page, kind: 'images', id: images[images.length - 1].id })
  } catch (err) {
    showError(`Image not saved: ${(err as Error).message}`)
  }
}
