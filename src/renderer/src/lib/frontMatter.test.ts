import { describe, expect, it } from 'vitest'
import { fontSize, frontMatter, imageAttributes, pageMargin } from './frontMatter'

const REPORT = [
  '---',
  'title: "RAND-1: The Hiring Problem"',
  'author: "Mathias Bouhon"',
  'date: "Ontwerp van Algoritmen (H0O07a), 2026-2027"',
  'lang: nl',
  'geometry: margin=1.8cm',
  'fontsize: 10pt',
  '---',
  '',
  '## 1. Opzet van de experimenten',
  ''
].join('\n')

describe('frontMatter', () => {
  it('reads the Pandoc block and returns the rest of the note', () => {
    const { meta, body } = frontMatter(REPORT)
    expect(meta).toEqual({
      title: 'RAND-1: The Hiring Problem',
      author: 'Mathias Bouhon',
      date: 'Ontwerp van Algoritmen (H0O07a), 2026-2027',
      lang: 'nl',
      geometry: 'margin=1.8cm',
      fontsize: '10pt'
    })
    expect(body).toBe('\n## 1. Opzet van de experimenten\n')
    expect(pageMargin(meta)).toBe('1.8cm')
    expect(fontSize(meta)).toBe('10pt')
  })

  it('leaves a note alone that only uses --- as a rule further down', () => {
    const note = '# Trees\n\n---\n\nMore text\n'
    expect(frontMatter(note)).toEqual({ meta: {}, body: note })
  })

  it('ignores lengths that are not plain values', () => {
    expect(pageMargin({ geometry: 'margin=1cm;} body{color:red' })).toBeNull()
    expect(fontSize({ fontsize: 'large' })).toBeNull()
  })
})

describe('imageAttributes', () => {
  it('turns a width into CSS', () => {
    expect(imageAttributes('{width=49%} rest')).toEqual({ style: 'width: 49%', length: 11 })
    expect(imageAttributes('{width=300 height="2cm"}')).toEqual({
      style: 'width: 300px; height: 2cm',
      length: 24
    })
  })

  it('is null for text that is not an attribute block', () => {
    expect(imageAttributes(' {width=49%}')).toBeNull()
    expect(imageAttributes('and then')).toBeNull()
  })
})
