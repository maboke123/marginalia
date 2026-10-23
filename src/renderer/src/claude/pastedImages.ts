import type { ChatImage } from '../../../shared/claude'

/** Claude sees no more detail beyond this many pixels on the long side; bigger only costs. */
const MAX_SIDE = 1568
/** The API takes images up to 5 MB; a big photo as PNG can go over that. */
const MAX_BYTES = 4 * 1024 * 1024

export const isImageFile = (file: File): boolean => file.type.startsWith('image/')

/**
 * A pasted or dropped image as Claude gets it: PNG or JPEG as it is when small enough,
 * otherwise drawn again at most MAX_SIDE wide or high (GIF, WebP and others become PNG).
 */
export async function chatImageOf(file: Blob): Promise<ChatImage> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  const ratio = Math.min(1, MAX_SIDE / Math.max(width, height))
  const asIs = file.type === 'image/png' || file.type === 'image/jpeg'
  if (asIs && ratio === 1 && file.size <= MAX_BYTES) {
    bitmap.close()
    return {
      mediaType: file.type as ChatImage['mediaType'],
      data: new Uint8Array(await file.arrayBuffer())
    }
  }
  const canvas = new OffscreenCanvas(Math.round(width * ratio), Math.round(height * ratio))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let blob = await canvas.convertToBlob({ type: 'image/png' })
  if (blob.size > MAX_BYTES) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
  return {
    mediaType: blob.type as ChatImage['mediaType'],
    data: new Uint8Array(await blob.arrayBuffer())
  }
}
