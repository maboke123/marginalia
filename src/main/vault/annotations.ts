import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import type { AnnotationFile } from '../../shared/annotations'

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

const isNumberArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((n) => typeof n === 'number')

/**
 * Indented JSON, except that arrays of numbers (and arrays of those, like a stroke's points)
 * stay on one line. A stroke is then a handful of lines instead of hundreds.
 */
export function formatAnnotations(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'number' || isNumberArray(v))) return JSON.stringify(value)
    if (value.length === 0) return '[]'
    const inner = indent + '  '
    return `[\n${value.map((v) => inner + formatAnnotations(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return '{}'
    const inner = indent + '  '
    const lines = entries.map(
      ([k, v]) => `${inner}${JSON.stringify(k)}: ${formatAnnotations(v, inner)}`
    )
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}

export function isAnnotationFile(value: unknown): value is AnnotationFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<AnnotationFile>
  if (file.version !== 1 || !file.pages || typeof file.pages !== 'object') return false
  return Object.values(file.pages).every(
    (page) =>
      page &&
      Array.isArray(page.strokes) &&
      Array.isArray(page.highlights) &&
      Array.isArray(page.textBoxes)
  )
}
