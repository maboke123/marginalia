import 'katex/dist/katex.min.css'
import MarkdownIt from 'markdown-it'
import katex from '@vscode/markdown-it-katex'

/**
 * Markdown has no underline, so Obsidian users write <u>text</u>. Raw HTML stays off for
 * safety; this rule lets exactly that one tag through.
 */
function underline(md: InstanceType<typeof MarkdownIt>): void {
  md.inline.ruler.before('html_inline', 'underline', (state, silent) => {
    const match = /^<(\/?)u>/i.exec(state.src.slice(state.pos))
    if (!match) return false
    if (!silent) {
      const closing = match[1] === '/'
      state.push(closing ? 'u_close' : 'u_open', 'u', closing ? -1 : 1)
    }
    state.pos += match[0].length
    return true
  })
}

// html: false escapes any other HTML in the source, so rendering with innerHTML is safe.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
  .use(katex, { throwOnError: false })
  .use(underline)

/** Markdown with $inline$ and $$display$$ math, the same syntax Obsidian uses. */
export function renderMarkdown(source: string): string {
  return md.render(source)
}
