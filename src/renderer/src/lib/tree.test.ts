import { describe, expect, it } from 'vitest'
import type { VaultNode } from '../../../shared/types'
import { displayOrder, visibleRows } from './tree'

const file = (path: string): VaultNode => ({
  name: path.split('/').pop()!,
  path,
  kind: /\.pdf$/i.test(path) ? 'pdf' : 'markdown'
})

const section = (path: string, names: string[]): VaultNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'section',
  children: names.map((n) => file(`${path}/${n}`))
})

const names = (nodes: VaultNode[]): string[] => nodes.map((n) => n.name)

describe('notes under their PDF', () => {
  const les3 = section('ML/les_3', [
    'B2 Decision trees.md',
    'B2 Decision trees.pdf',
    'Exercises.pdf',
    'Summary.md'
  ])

  it('shows a note with the same name right under its PDF, one level deeper', () => {
    const rows = visibleRows([les3], { 'ML/les_3': true })
    expect(rows.map((r) => [r.node.name, r.depth, r.pairedWith ?? null])).toEqual([
      ['les_3', 0, null],
      ['B2 Decision trees.pdf', 1, null],
      ['B2 Decision trees.md', 2, 'ML/les_3/B2 Decision trees.pdf'],
      ['Exercises.pdf', 1, null],
      ['Summary.md', 1, null]
    ])
  })

  it('shows the linked notes and the same-named one under the PDF', () => {
    const order = displayOrder(les3.children!, {
      'ML/les_3/B2 Decision trees.pdf': ['ML/les_3/Summary.md']
    })
    expect(names(order)).toEqual([
      'B2 Decision trees.pdf',
      'B2 Decision trees.md',
      'Summary.md',
      'Exercises.pdf'
    ])
  })

  it('lets a linked note win over a same-named PDF', () => {
    const order = displayOrder(les3.children!, {
      'ML/les_3/Exercises.pdf': ['ML/les_3/B2 Decision trees.md']
    })
    expect(names(order)).toEqual([
      'B2 Decision trees.pdf',
      'Exercises.pdf',
      'B2 Decision trees.md',
      'Summary.md'
    ])
  })

  it('gives a note to one PDF only and ignores links to other folders', () => {
    const order = displayOrder(les3.children!, {
      'ML/les_3/B2 Decision trees.pdf': ['ML/les_3/Summary.md'],
      'ML/les_3/Exercises.pdf': ['ML/les_3/Summary.md']
    })
    expect(names(order)).toEqual([
      'B2 Decision trees.pdf',
      'B2 Decision trees.md',
      'Summary.md',
      'Exercises.pdf'
    ])
    const elsewhere = displayOrder(les3.children!, {
      'ML/les_3/Exercises.pdf': ['ML/les_4/Exercises.md']
    })
    expect(names(elsewhere)).toEqual(names(displayOrder(les3.children!, {})))
  })

  it('hides transcripts until their folder shows them, and counts them on the folder', () => {
    const les = section('ML/les_8', [
      'slides.pdf',
      'Transcript 2026-10-15 10-00.md',
      'Transcript 2026-10-15 12-00.md'
    ])
    const links = { 'ML/les_8/slides.pdf': ['ML/les_8/Transcript 2026-10-15 10-00.md'] }
    const shown = (expanded: Record<string, boolean>, reveal: string[] = []): string[] =>
      visibleRows([les], expanded, links, new Set(reveal)).map((r) => r.node.name)

    expect(visibleRows([les], {}, links)[0].transcripts).toBe(2)
    expect(shown({ 'ML/les_8': true })).toEqual(['les_8', 'slides.pdf'])
    expect(shown({ 'ML/les_8': true }, ['ML/les_8/Transcript 2026-10-15 12-00.md'])).toEqual([
      'les_8',
      'slides.pdf',
      'Transcript 2026-10-15 12-00.md'
    ])
    expect(shown({ 'ML/les_8': true, 'ML/les_8#transcripts': true })).toEqual([
      'les_8',
      'slides.pdf',
      'Transcript 2026-10-15 10-00.md',
      'Transcript 2026-10-15 12-00.md'
    ])
  })

  it('matches names without caring about case', () => {
    const order = displayOrder(
      section('A/b', ['slides.PDF', 'notes.md', 'Slides.md']).children!,
      {}
    )
    expect(names(order)).toEqual(['slides.PDF', 'Slides.md', 'notes.md'])
  })
})
