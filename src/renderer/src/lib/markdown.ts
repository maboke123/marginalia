import 'katex/dist/katex.min.css'
import MarkdownIt from 'markdown-it'
import katex from '@vscode/markdown-it-katex'
import { CLOSE_TAG, OPEN_TAG } from '../../../shared/textColor'
import { DIAGRAM_LANGS, diagramPlaceholder } from './diagrams'

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

/** `<span style="color: red">` with a notebook colour name, drawn with the theme's colour. */
function textColor(md: InstanceType<typeof MarkdownIt>): void {
  md.inline.ruler.before('html_inline', 'text_color', (state, silent) => {
    const rest = state.src.slice(state.pos)
    const open = OPEN_TAG.exec(rest)
    const close = open ? null : CLOSE_TAG.exec(rest)
    if (!open && !close) return false
    // A closing tag only counts when a colour span is open; otherwise it stays plain text.
    const depth = state.tokens.reduce(
      (n, t) => n + (t.type === 'color_open' ? 1 : t.type === 'color_close' ? -1 : 0),
      0
    )
    if (close && depth <= 0) return false
    if (!silent) {
      if (open) state.push('color_open', 'span', 1).attrSet('class', `tc-${open[1].toLowerCase()}`)
      else state.push('color_close', 'span', -1)
    }
    state.pos += (open ?? close)![0].length
    return true
  })
}

/** ```mermaid and ```vega-lite blocks become placeholders that `hydrateDiagrams` draws. */
function diagrams(md: InstanceType<typeof MarkdownIt>): void {
  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const lang = token.info.trim().split(/s+/)[0].toLowerCase()
    if (DIAGRAM_LANGS.has(lang)) return diagramPlaceholder(lang, token.content)
    return fence(tokens, idx, options, env, self)
  }
}

// html: false escapes any other HTML in the source, so rendering with innerHTML is safe.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
  .use(katex, { throwOnError: false })
  .use(underline)
  .use(textColor)
  .use(diagrams)

/** Markdown with $inline$ and $$display$$ math, the same syntax Obsidian uses. */
export function renderMarkdown(source: string): string {
  return md.render(source)
}

// Chat answers: code blocks get a copy button (the panel handles its clicks).
const chatMd = new MarkdownIt({ html: false, linkify: true, breaks: false })
  .use(katex, { throwOnError: false })
  .use(underline)
  .use(textColor)
const fence = chatMd.renderer.rules.fence!
chatMd.renderer.rules.fence = (tokens, idx, options, env, self) =>
  '<div class="code-block"><button type="button" class="copy-code">Copy</button>' +
  fence(tokens, idx, options, env, self) +
  '</div>'
chatMd.use(diagrams)

export function renderChatMarkdown(source: string): string {
  return chatMd.render(source)
}
