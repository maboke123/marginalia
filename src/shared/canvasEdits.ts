import type { CanvasData, CanvasEdge, CanvasNode } from './canvas'

const MAX_LINES = 40

/** The name of a box in a sentence: a class name, a group label, a file. */
function nameOf(node: CanvasNode | undefined): string {
  if (!node) return 'a box that is gone'
  if (node.type === 'text') {
    const first = linesOf(node.text).find((l) => !/^«.*»$/.test(l))
    return `"${first ?? node.id}"`
  }
  if (node.type === 'group') return `group "${node.label ?? node.id}"`
  if (node.type === 'file') return node.file
  if (node.type === 'link') return node.url
  return 'a drawing'
}

/** The lines that carry meaning: no compartment rules, no bold marks, no blank lines. */
function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\*\*/g, '').trim())
    .filter((l) => l && l !== '---')
}

function describeNode(node: CanvasNode): string {
  if (node.type !== 'text') return nameOf(node)
  const [, ...rest] = linesOf(node.text)
  const kind = node.shape ?? 'box'
  return `${kind} ${nameOf(node)}${rest.length ? ` (${rest.join(' | ')})` : ''}`
}

/** Lines of `a` that `b` does not have, counting repeats. */
function without(a: string[], b: string[]): string[] {
  const left = [...b]
  return a.filter((line) => {
    const i = left.indexOf(line)
    if (i === -1) return true
    left.splice(i, 1)
    return false
  })
}

const quoted = (lines: string[]): string => lines.map((l) => `"${l}"`).join(', ')

function nodeChanges(old: CanvasNode, now: CanvasNode): string[] {
  const out: string[] = []
  const name = nameOf(now) === nameOf(old) ? nameOf(now) : `${nameOf(old)} (now ${nameOf(now)})`
  if (old.type === 'text' && now.type === 'text') {
    if ((old.shape ?? 'box') !== (now.shape ?? 'box')) {
      out.push(`${name}: ${old.shape ?? 'box'} became ${now.shape ?? 'box'}`)
    }
    const removed = without(linesOf(old.text), linesOf(now.text))
    const added = without(linesOf(now.text), linesOf(old.text))
    if (removed.length || added.length) {
      const parts = [
        removed.length && `removed ${quoted(removed)}`,
        added.length && `added ${quoted(added)}`
      ].filter(Boolean)
      out.push(`In ${name}: ${parts.join('; ')}`)
    }
  } else if (old.type === 'group' && now.type === 'group' && old.label !== now.label) {
    out.push(`Renamed ${nameOf(old)} to "${now.label ?? ''}"`)
  }
  return out
}

const relationOf = (e: CanvasEdge): string => e.relation ?? 'plain arrow'

function describeEdge(e: CanvasEdge, nodes: Map<string, CanvasNode>): string {
  const extra = [
    e.label && `label "${e.label}"`,
    e.fromLabel && `"${e.fromLabel}" at ${nameOf(nodes.get(e.fromNode))}`,
    e.toLabel && `"${e.toLabel}" at ${nameOf(nodes.get(e.toNode))}`
  ].filter(Boolean)
  return `${arrowOf(e, nodes)} (${[relationOf(e), ...extra].join(', ')})`
}

const arrowOf = (e: CanvasEdge, nodes: Map<string, CanvasNode>): string =>
  `${nameOf(nodes.get(e.fromNode))} -> ${nameOf(nodes.get(e.toNode))}`

function edgeChanges(old: CanvasEdge, now: CanvasEdge, nodes: Map<string, CanvasNode>): string[] {
  const out: string[] = []
  const arrow = `the arrow ${arrowOf(now, nodes)}`
  if (old.fromNode === now.toNode && old.toNode === now.fromNode) {
    out.push(`Turned around the arrow ${arrowOf(old, nodes)}: now ${arrowOf(now, nodes)}`)
  } else if (old.fromNode !== now.fromNode || old.toNode !== now.toNode) {
    out.push(`Moved the arrow ${arrowOf(old, nodes)}: now ${arrowOf(now, nodes)}`)
  }
  if (relationOf(old) !== relationOf(now)) {
    out.push(`The arrow ${arrowOf(now, nodes)}: ${relationOf(old)} became ${relationOf(now)}`)
  }
  const label = (key: 'label' | 'fromLabel' | 'toLabel', what: string): void => {
    const was = old[key] ?? ''
    const is = now[key] ?? ''
    if (was === is) return
    out.push(
      is
        ? `${what} of ${arrow}: "${is}"${was ? ` (was "${was}")` : ''}`
        : `Removed ${what.toLowerCase()} "${was}" of ${arrow}`
    )
  }
  label('label', 'Label')
  // A swapped arrow takes its multiplicities along: compare them by box, not by end.
  const swapped = old.fromNode === now.toNode && old.toNode === now.fromNode
  const flipped = swapped ? { ...old, fromLabel: old.toLabel, toLabel: old.fromLabel } : old
  const end = (key: 'fromLabel' | 'toLabel', node: string): void => {
    const was = flipped[key] ?? ''
    const is = now[key] ?? ''
    if (was === is) return
    const at = nameOf(nodes.get(node))
    out.push(
      is
        ? `Multiplicity at ${at} of ${arrow}: "${is}"${was ? ` (was "${was}")` : ''}`
        : `Removed multiplicity "${was}" at ${at} of ${arrow}`
    )
  }
  end('fromLabel', now.fromNode)
  end('toLabel', now.toNode)
  return out
}

const pairKey = (e: CanvasEdge): string => [e.fromNode, e.toNode].sort().join('\n')

/**
 * What changed on a canvas between two versions, in words: boxes and arrows added, removed
 * or changed. Moving and resizing is left out: that is layout, not modelling. An arrow
 * removed and drawn again between the same boxes counts as changed.
 */
export function canvasEdits(before: CanvasData, after: CanvasData): string[] {
  const out: string[] = []
  const was = new Map(before.nodes.map((n) => [n.id, n]))
  const is = new Map(after.nodes.map((n) => [n.id, n]))
  const all = new Map([...was, ...is])

  for (const n of after.nodes) {
    const old = was.get(n.id)
    if (!old) out.push(`Added ${describeNode(n)}`)
    else out.push(...nodeChanges(old, n))
  }
  for (const n of before.nodes) if (!is.has(n.id)) out.push(`Removed ${describeNode(n)}`)

  const oldEdges = new Map(before.edges.map((e) => [e.id, e]))
  const newIds = new Set(after.edges.map((e) => e.id))
  const removed = before.edges.filter((e) => !newIds.has(e.id))
  for (const e of after.edges) {
    const old = oldEdges.get(e.id)
    if (old) {
      out.push(...edgeChanges(old, e, all))
      continue
    }
    const again = removed.findIndex((r) => pairKey(r) === pairKey(e))
    if (again !== -1) {
      out.push(...edgeChanges(removed[again], e, all))
      removed.splice(again, 1)
    } else {
      out.push(`Added the arrow ${describeEdge(e, all)}`)
    }
  }
  for (const e of removed) out.push(`Removed the arrow ${describeEdge(e, all)}`)

  return out.length > MAX_LINES
    ? [...out.slice(0, MAX_LINES), `And ${out.length - MAX_LINES} more changes`]
    : out
}
