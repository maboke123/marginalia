import { describe, expect, it } from 'vitest'
import { parseStyle, restyle, STYLE_TAG } from './textStyle'

describe('STYLE_TAG', () => {
  it('reads colours, sizes and both', () => {
    expect(STYLE_TAG.exec('<span style="color: #cf222e">x')?.[1]).toBe('color: #cf222e')
    expect(STYLE_TAG.exec('<span style="color: red">x')).not.toBeNull()
    expect(parseStyle('color: #CF222E; font-size: 1.4em;')).toEqual({ color: '#cf222e', size: 1.4 })
  })

  it('leaves other styles alone', () => {
    expect(STYLE_TAG.exec('<span style="background: url(x)">')).toBeNull()
    expect(STYLE_TAG.exec('<span style="color: #cf222e; position: fixed">')).toBeNull()
  })
})

describe('restyle', () => {
  const text = 'Gain is the drop in entropy'

  it('wraps a range and keeps its text selected', () => {
    const result = restyle(text, 12, 16, { color: '#cf222e' })!
    expect(result.text).toBe('Gain is the <span style="color: #cf222e">drop</span> in entropy')
    expect(result.text.slice(result.from, result.to)).toBe('drop')
  })

  it('changes a span when its text is selected again, instead of nesting', () => {
    const red = restyle(text, 12, 16, { color: '#cf222e' })!
    const big = restyle(red.text, red.from, red.to, { size: 1.4 })!
    expect(big.text).toBe(
      'Gain is the <span style="color: #cf222e; font-size: 1.4em">drop</span> in entropy'
    )
    const blue = restyle(big.text, big.from, big.to, { color: '#1f6feb' })!
    expect(blue.text).toContain('<span style="color: #1f6feb; font-size: 1.4em">drop</span>')
  })

  it('takes the tags away when nothing is left', () => {
    const red = restyle(text, 12, 16, { color: '#cf222e' })!
    const plain = restyle(red.text, red.from, red.to, { color: null })!
    expect(plain.text).toBe(text)
    expect(plain.text.slice(plain.from, plain.to)).toBe('drop')
  })

  it('also finds the span when its tags are selected with it', () => {
    const red = restyle(text, 12, 16, { color: '#cf222e' })!
    const all = restyle(red.text, 12, red.to + '</span>'.length, { color: '#1a7f37' })!
    expect(all.text).toBe('Gain is the <span style="color: #1a7f37">drop</span> in entropy')
  })

  it('changes nothing for an empty range or nothing to set', () => {
    expect(restyle(text, 3, 3, { color: '#cf222e' })).toBeNull()
    expect(restyle(text, 0, 4, { color: null })).toBeNull()
  })
})
