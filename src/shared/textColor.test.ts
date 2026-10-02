import { describe, expect, it } from 'vitest'
import { blankColorTags, colorSpans, recolor } from './textColor'

const red = (t: string): string => `<span style="color: red">${t}</span>`
const blue = (t: string): string => `<span style="color: blue">${t}</span>`

/** recolor with the range given as the marked part of `line`: "a [b] c". */
function apply(marked: string, color: 'red' | 'blue' | null): string | null {
  const from = marked.indexOf('[')
  const to = marked.indexOf(']') - 1
  const line = marked.replace('[', '').replace(']', '')
  const result = recolor(line, from, to, color)
  if (!result) return null
  return (
    result.text.slice(0, result.from) +
    '[' +
    result.text.slice(result.from, result.to) +
    ']' +
    result.text.slice(result.to)
  )
}

describe('colorSpans', () => {
  it('finds spans with the notebook colours, in the ways Obsidian users write them', () => {
    const line = `a ${red('b')} <span style='color:Teal;'>c</span> <span style="color: purple">d</span>`
    expect(colorSpans(line).map((s) => [s.color, line.slice(s.openTo, s.closeFrom)])).toEqual([
      ['red', 'b'],
      ['teal', 'c']
    ])
  })
})

describe('recolor', () => {
  it('wraps a selection', () => {
    expect(apply('Gain is [high] here', 'red')).toBe(`Gain is ${red('[high]')} here`)
  })

  it('changes or removes the colour of a whole span', () => {
    expect(apply(`a ${red('[b]')} c`, 'blue')).toBe(`a ${blue('[b]')} c`)
    expect(apply(`a ${red('[b]')} c`, null)).toBe('a [b] c')
  })

  it('splits a span when part of it changes', () => {
    expect(apply(`${red('ab[c]de')}`, 'blue')).toBe(`${red('ab')}${blue('[c]')}${red('de')}`)
    expect(apply(`${red('ab[c]de')}`, null)).toBe(`${red('ab')}[c]${red('de')}`)
  })

  it('merges with a neighbour of the same colour instead of nesting', () => {
    expect(apply(`${red('ab')}[cd] e`, 'red')).toBe(`${red('ab[cd]')} e`)
    expect(apply(`x [y ${red('z')} w] v`, 'blue')).toBe(`x ${blue('[y z w]')} v`)
  })

  it('treats a selection that ends inside a tag as ending at the text', () => {
    const line = `a ${red('b')} c`
    const result = recolor(line, 0, line.indexOf('b') - 3, 'blue')!
    expect(result.text).toBe(`${blue('a ')}${red('b')} c`)
  })

  it('changes the span the cursor is in, or starts an empty one', () => {
    const line = `a ${red('bc')} d`
    const inside = line.indexOf('bc') + 1
    expect(recolor(line, inside, inside, 'blue')!.text).toBe(`a ${blue('bc')} d`)
    const result = recolor('a b', 2, 2, 'red')!
    expect(result.text).toBe(`a ${red('')}b`)
    expect(result.from).toBe(2 + '<span style="color: red">'.length)
    expect(recolor('a b', 2, 2, null)).toBeNull()
  })

  it('returns null when nothing changes', () => {
    expect(apply(`${red('[ab]')}`, 'red')).toBeNull()
  })
})

describe('blankColorTags', () => {
  it('hides tags from search without moving text', () => {
    const line = `a ${red('b')} c`
    expect(blankColorTags(line)).toHaveLength(line.length)
    expect(blankColorTags(line).replace(/\s+/g, ' ')).toBe('a b c')
  })
})
