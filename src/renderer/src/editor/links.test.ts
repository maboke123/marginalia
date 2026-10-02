import { describe, expect, it } from 'vitest'
import { relativeHref, resolveLink, slideLink, vaultUrl } from './links'

const note = 'Machine Learning/B2 Decision trees/Summary.md'

describe('links', () => {
  it('resolves slide links relative to the note', () => {
    expect(resolveLink(note, 'slides.pdf#page=12')).toEqual({
      path: 'Machine Learning/B2 Decision trees/slides.pdf',
      page: 12
    })
    expect(resolveLink(note, '../B3%20Ensembles/slides.pdf')).toEqual({
      path: 'Machine Learning/B3 Ensembles/slides.pdf',
      page: null
    })
  })

  it('ignores web links and paths outside the vault', () => {
    expect(resolveLink(note, 'https://example.org/a.pdf')).toBeNull()
    expect(resolveLink(note, '../../../outside.pdf')).toBeNull()
  })

  it('builds encoded relative links', () => {
    expect(relativeHref(note, 'Machine Learning/B2 Decision trees/slides.pdf')).toBe('slides.pdf')
    expect(relativeHref(note, 'Machine Learning/B3 Ensembles/les 3.pdf')).toBe(
      '../B3%20Ensembles/les%203.pdf'
    )
    expect(slideLink(note, 'Machine Learning/B2 Decision trees/slides.pdf', 12)).toBe(
      '[slide 12](slides.pdf#page=12)'
    )
  })

  it('makes vault URLs for images', () => {
    expect(vaultUrl('ML/B2/assets/2026-10-02_14-31-05.png')).toBe(
      'vault://local/ML/B2/assets/2026-10-02_14-31-05.png'
    )
    expect(vaultUrl('Machine Learning/a#b.png')).toBe('vault://local/Machine%20Learning/a%23b.png')
  })
})
