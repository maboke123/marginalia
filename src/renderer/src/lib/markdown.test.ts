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

  it('lets coloured and sized spans through, and nothing else in a style', () => {
    expect(renderMarkdown('<span style="color: red">a</span>')).toContain(
      '<span class="tc-red">a</span>'
    )
    expect(renderMarkdown('<span style="color: #cf222e; font-size: 1.4em">a</span>')).toContain(
      '<span style="color: #cf222e; font-size: 1.4em">a</span>'
    )
    expect(renderMarkdown('<span style="position: fixed">a</span>')).toContain('&lt;span')
  })

  it('turns mermaid and vega-lite blocks into diagram placeholders', () => {
    const source = '```mermaid\ngraph TD\n  A --> B["<b>"]\n```\n\n```js\nx\n```'
    const html = renderMarkdown(source)
    expect(html).toContain('<div class="diagram" data-lang="mermaid"')
    expect(html).toContain('data-source="graph TD\n  A --&gt; B[&quot;&lt;b&gt;&quot;]\n"')
    expect(html).toContain('<code class="language-js">')
    expect(renderMarkdown('```vega-lite\n{}\n```')).toContain('data-lang="vega-lite"')
  })
})
