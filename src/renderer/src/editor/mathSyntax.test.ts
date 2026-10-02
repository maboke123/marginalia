import { describe, expect, it } from 'vitest'
import { GFM, parser as baseParser } from '@lezer/markdown'
import { mathSyntax } from './mathSyntax'

const parser = baseParser.configure([GFM, mathSyntax])

function nodes(text: string, name: string): string[] {
  const found: string[] = []
  parser.parse(text).iterate({
    enter: (node) => {
      if (node.name === name) found.push(text.slice(node.from, node.to))
    }
  })
  return found
}

describe('math syntax', () => {
  it('finds inline math', () => {
    expect(nodes('Gain is $IG(S,t)$ here', 'InlineMath')).toEqual(['$IG(S,t)$'])
    expect(nodes('costs $5 and $10', 'InlineMath')).toEqual([])
    expect(nodes('escaped \\$ and $a \\$ b$', 'InlineMath')).toEqual(['$a \\$ b$'])
  })

  it('finds $$display$$ math in the middle of a line, without a stray $', () => {
    expect(nodes('A: $$x_{k+1} = x_k$$ and more', 'InlineMath')).toEqual(['$$x_{k+1} = x_k$$'])
    expect(nodes('A: $$ x $$ too', 'InlineMath')).toEqual(['$$ x $$'])
    expect(nodes('A: $$x$$\nB: $y$', 'InlineMath')).toEqual(['$$x$$', '$y$'])
  })

  it('never runs inline math across a line break', () => {
    // A lone $ at the end of a line must not pair with a $ on the next line.
    expect(nodes('total $\nB: costs $5$ now', 'InlineMath')).toEqual(['$5$'])
    expect(nodes('A: $$x\nB: y$$', 'InlineMath')).toEqual([])
  })

  it('keeps emphasis markers inside math as math', () => {
    expect(nodes('$a*b*c$', 'Emphasis')).toEqual([])
  })

  it('finds display math over several lines', () => {
    const text = 'Before\n\n$$\nH(S) = -\\sum p \\log p\n$$\n\nAfter'
    expect(nodes(text, 'BlockMath')).toEqual(['$$\nH(S) = -\\sum p \\log p\n$$'])
    expect(nodes(text, 'Paragraph')).toEqual(['Before', 'After'])
  })

  it('treats an unclosed block as running to the end', () => {
    expect(nodes('$$\nx^2', 'BlockMath')).toEqual(['$$\nx^2'])
  })
})
