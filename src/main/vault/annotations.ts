import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import type { AnnotationFile } from '../../shared/annotations'

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export { compactJson as formatAnnotations } from '../../shared/compactJson'

export function isAnnotationFile(value: unknown): value is AnnotationFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<AnnotationFile>
  if (file.version !== 1 || !file.pages || typeof file.pages !== 'object') return false
  return Object.values(file.pages).every(
    (page) =>
      page &&
      Array.isArray(page.strokes) &&
      Array.isArray(page.highlights) &&
      Array.isArray(page.textBoxes) &&
      (page.images === undefined || Array.isArray(page.images))
  )
}
