import { compartments, type CanvasData, type TextNode } from '../../../shared/canvas'

const SEPARATOR = /^\s*-{3,}\s*$/
const PLACEHOLDER = '+ operation(): Type'

/** The operations of a class: lines with a "(" below its name. */
export function operations(text: string): string[] {
  return compartments(text)
    .slice(1)
    .flatMap((part) => part.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.includes('(') && line !== PLACEHOLDER)
}

/** An operation's name, without visibility, italics (abstract) or {abstract}. */
export const operationName = (op: string): string =>
  op
    .replace(/\{abstract\}/gi, '')
    .replace(/[*_]/g, '')
    .trim()
    .replace(/^[+\-#~]\s*/, '')
    .split('(')[0]
    .trim()

/** The operation as the subclass writes it: no longer abstract. */
const concrete = (op: string): string =>
  op
    .replace(/\s*\{abstract\}/gi, '')
    .replace(/[*_]/g, '')
    .trim()

/**
 * Operations a class gets from the classes and interfaces its inheritance or realization
 * arrows point at (and theirs, further up), that it does not have itself yet.
 */
export function inheritedOperations(data: CanvasData, id: string): string[] {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const own = byId.get(id)
  if (own?.type !== 'text') return []
  const have = new Set(operations(own.text).map(operationName))
  const found: string[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of data.edges) {
      if (edge.fromNode !== current || seen.has(edge.toNode)) continue
      if (edge.relation !== 'inheritance' && edge.relation !== 'realization') continue
      seen.add(edge.toNode)
      queue.push(edge.toNode)
      const parent = byId.get(edge.toNode) as TextNode | undefined
      for (const op of parent?.type === 'text' ? operations(parent.text) : []) {
        const name = operationName(op)
        if (have.has(name)) continue
        have.add(name)
        found.push(concrete(op))
      }
    }
  }
  return found
}

/** Whether `offset` lies in the part of a class where its operations go. */
export function inOperations(text: string, offset: number): boolean {
  const before = text.slice(0, offset).split('\n')
  const separators = before.filter((line) => SEPARATOR.test(line)).length
  if (separators === 0) return false
  const total = text.split('\n').filter((line) => SEPARATOR.test(line)).length
  // The last compartment, or the one where operations are already.
  return separators === total || separators >= 2
}

/**
 * The text with `ops` in place of the line holding `offset` (an empty line or what I started
 * typing), and where the cursor goes after them.
 */
export function insertOperations(
  text: string,
  offset: number,
  ops: string[]
): { text: string; cursor: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const end = lineEnd < 0 ? text.length : lineEnd
  const inserted = ops.join('\n')
  return {
    text: text.slice(0, start) + inserted + text.slice(end),
    cursor: start + inserted.length
  }
}
