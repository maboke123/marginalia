import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders inline and display math with KaTeX', () => {
    expect(renderMarkdown('gain $IG(S,t)$')).toContain('class="katex"')
    expect(renderMarkdown('$$\n\\frac{a}{b}\n$$')).toContain('katex-display')
  })

  it('allows <u> but escapes every other tag', () => {
    const html = renderMarkdown('**bold** <u>under</u> <script>alert(1)</script>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<u>under</u>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
