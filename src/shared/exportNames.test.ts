import { describe, expect, it } from 'vitest'
import { exportNames } from './exportNames'

describe('exportNames', () => {
  it('keeps subfolders and gives a note named like its slides its own name', () => {
    const names = exportNames('DSS/les_6', [
      { path: 'DSS/les_6/11 Double Dispatch.md', kind: 'markdown' },
      { path: 'DSS/les_6/11 Double Dispatch.pdf', kind: 'pdf' },
      { path: 'DSS/les_6/excercises/webshop.canvas', kind: 'canvas' },
      { path: 'DSS/les_6/excercises/webshop.md', kind: 'markdown' }
    ])
    expect(names.get('DSS/les_6/11 Double Dispatch.pdf')).toBe('11 Double Dispatch.pdf')
    expect(names.get('DSS/les_6/11 Double Dispatch.md')).toBe('11 Double Dispatch (notes).pdf')
    expect(names.get('DSS/les_6/excercises/webshop.canvas')).toBe('excercises/webshop.pdf')
    expect(names.get('DSS/les_6/excercises/webshop.md')).toBe('excercises/webshop (notes).pdf')
  })
})
