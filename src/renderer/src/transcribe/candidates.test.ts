import { describe, expect, it } from 'vitest'
import type { VaultNode } from '../../../shared/types'
import { slideCandidates } from './candidates'

const pdf = (path: string): VaultNode => ({ name: path.split('/').pop()!, path, kind: 'pdf' })
const folder = (path: string, children: VaultNode[]): VaultNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'section',
  children
})

const course = folder('J1/ML', [
  folder('J1/ML/les_2', [pdf('J1/ML/les_2/B1.pdf')]),
  folder('J1/ML/les_3', [
    pdf('J1/ML/les_3/B2.pdf'),
    { name: 'Notes.md', path: 'J1/ML/les_3/Notes.md', kind: 'markdown' },
    folder('J1/ML/les_3/part 2', [pdf('J1/ML/les_3/part 2/B3.pdf')])
  ])
])
const nodes: VaultNode[] = [{ ...folder('J1', [course]), kind: 'notebook' }]

describe('slideCandidates', () => {
  it('takes every deck of the lesson, subsections too, and the rest of the course as nearby', () => {
    expect(slideCandidates(nodes, { folder: 'J1/ML/les_3' })).toEqual([
      { pdf: 'J1/ML/les_3/B2.pdf', group: 'here' },
      { pdf: 'J1/ML/les_3/part 2/B3.pdf', group: 'here' },
      { pdf: 'J1/ML/les_2/B1.pdf', group: 'nearby' }
    ])
  })

  it('takes only the PDF a video was dropped on as here', () => {
    expect(slideCandidates(nodes, { folder: 'J1/ML/les_3', pdf: 'J1/ML/les_3/B2.pdf' })).toEqual([
      { pdf: 'J1/ML/les_3/B2.pdf', group: 'here' },
      { pdf: 'J1/ML/les_2/B1.pdf', group: 'nearby' },
      { pdf: 'J1/ML/les_3/part 2/B3.pdf', group: 'nearby' }
    ])
  })
})
