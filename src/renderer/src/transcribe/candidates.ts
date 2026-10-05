import type { VaultNode } from '../../../shared/types'
import { findNode, parentOf } from '../lib/tree'

export interface Candidate {
  pdf: string
  group: 'here' | 'nearby'
}

function pdfsUnder(node: VaultNode | null): string[] {
  if (!node) return []
  if (node.kind === 'pdf') return [node.path]
  return (node.children ?? []).flatMap(pdfsUnder)
}

/**
 * The slide decks a lecture video may show. `here`: the PDF it was dropped on, or every PDF in
 * the lesson folder it was dropped on (subsections too, for a lesson split over several decks).
 * `nearby`: the rest of the course, because a lecturer may go back to finish the previous one.
 */
export function slideCandidates(
  nodes: VaultNode[],
  target: { folder: string; pdf?: string }
): Candidate[] {
  const here = target.pdf ? [target.pdf] : pdfsUnder(findNode(nodes, target.folder))
  const lesson = target.pdf ? parentOf(target.pdf) : target.folder
  const course = parentOf(lesson) || lesson
  const nearby = pdfsUnder(findNode(nodes, course)).filter((p) => !here.includes(p))
  return [
    ...here.map((pdf) => ({ pdf, group: 'here' as const })),
    ...nearby.map((pdf) => ({ pdf, group: 'nearby' as const }))
  ]
}
