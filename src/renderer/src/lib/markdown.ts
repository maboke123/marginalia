import 'katex/dist/katex.min.css'
import MarkdownIt from 'markdown-it'
import katex from '@vscode/markdown-it-katex'

// html: false escapes any HTML in the source, so rendering text with innerHTML is safe.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(katex, {
  throwOnError: false
})

/** Markdown with $inline$ and $$display$$ math, the same syntax Obsidian uses. */
export function renderMarkdown(source: string): string {
  return md.render(source)
}
