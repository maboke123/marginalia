const isNumberArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((n) => typeof n === 'number')

/**
 * Indented JSON, except that arrays of numbers (and arrays of those, like a stroke's points)
 * stay on one line. A stroke is then a handful of lines instead of hundreds.
 */
export function compactJson(value: unknown, indent = ''): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'number' || isNumberArray(v))) return JSON.stringify(value)
    if (value.length === 0) return '[]'
    const inner = indent + '  '
    return `[\n${value.map((v) => inner + compactJson(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return '{}'
    const inner = indent + '  '
    const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, inner)}`)
    return `{\n${lines.join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}
