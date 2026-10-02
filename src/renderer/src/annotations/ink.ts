import type { Stroke } from '../../../shared/annotations'
import { strokeOutline } from '../../../shared/ink'

const cache = new WeakMap<Stroke, string>()

/** SVG path of a stroke in page points. Cached per stroke object, which never changes. */
export function strokePath(stroke: Stroke, live = false): string {
  const cached = cache.get(stroke)
  if (cached !== undefined) return cached
  const d = strokeOutline(stroke, live)
  if (!live) cache.set(stroke, d)
  return d
}
