import { describe, expect, it } from 'vitest'
import { matchText, terms, type SlideText } from './textMatch'

const deck = (pdf: string, pages: string[], group: 'here' | 'nearby' = 'here'): SlideText[] =>
  pages.map((text, i) => ({ pdf, page: i + 1, group, text: `${text}\nRoel Wuyts - DSS` }))

const grasp = deck('DSS/les_4/8 GRASP.pdf', [
  'GRASP patterns: general responsibility assignment software patterns',
  'Information expert: assign a responsibility to the class that has the information',
  'Creator: class B creates instances of A when B contains or aggregates A',
  'Low coupling: dependencies between classes, impact of change',
  'High cohesion: focused responsibilities, manageable classes',
  'Controller: first object beyond the UI layer that receives a system operation'
])

const said = (pick: number[]): string[] =>
  pick.map(
    (p) =>
      `So, right, what we see here is ${grasp[p - 1].text.split('\n')[0].toLowerCase()}, ` +
      'and you will need this for the project, okay?'
  )

describe('matching a transcript with slides by its words', () => {
  it('folds, drops filler words and plurals', () => {
    expect(terms('The Classes and their Responsibilities, okay?')).toEqual([
      'class',
      'responsibility'
    ])
  })

  it('follows the lecture through the deck, a slide or a few at a time', () => {
    const parts = said([1, 2, 2, 3, 5, 6])
    expect(matchText(parts, grasp).map((i) => (i === null ? null : grasp[i].page))).toEqual([
      1, 2, 2, 3, 5, 6
    ])
  })

  it('keeps a vague paragraph on the slide around it', () => {
    const parts = said([2, 2])
    parts.splice(1, 0, 'Yes, exactly, good question. Let me think about that for a second.')
    expect(matchText(parts, grasp).map((i) => i !== null && grasp[i].page)).toEqual([2, 2, 2])
  })

  it('leaves a long stretch about nothing on the slides without a slide', () => {
    const chat = 'The exam is in January, the room is announced on Toledo, bring your student card.'
    const parts = [...said([1]), ...Array<string>(6).fill(chat), ...said([2])]
    const got = matchText(parts, grasp)
    expect(got[0]).toBe(0)
    expect(got.slice(1, 7)).toEqual(Array(6).fill(null))
    expect(got[7]).toBe(1)
  })

  it('prefers the decks of this lesson over others with the same words', () => {
    const old = deck('DSS/les_2/4 Basic OO.pdf', [grasp[3].text.split('\n')[0]], 'nearby')
    const slides = [...old, ...grasp]
    const got = matchText(said([4]), slides)
    expect(slides[got[0]!].pdf).toBe('DSS/les_4/8 GRASP.pdf')
  })

  it('gives nothing without slides or text', () => {
    expect(matchText([], grasp)).toEqual([])
    expect(matchText(['hello'], [])).toEqual([null])
  })
})
