import { resolveLink, vaultUrl } from '../editor/links'
import { drawDiagrams } from './diagrams'
import { renderMarkdown } from './markdown'

const PRINT_CSS = `
body {
  margin: 0;
  font-family: var(--font);
  font-size: 11pt;
  line-height: 1.5;
  color: var(--paper-text);
  background: var(--page-bg);
}
h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 0.4em; break-after: avoid; }
h1 { font-size: 20pt; }
h2 { font-size: 15pt; }
h3 { font-size: 12.5pt; }
p, ul, ol, table, pre, blockquote, .katex-display, .diagram { margin: 0 0 0.7em; }
img, svg { max-width: 100%; height: auto; }
img, table, pre, .katex-display, .diagram { break-inside: avoid; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--paper-rule); padding: 3pt 6pt; text-align: left; }
code { font-family: var(--font-mono); font-size: 0.92em; }
pre { padding: 6pt 8pt; border: 1px solid var(--paper-rule); border-radius: var(--radius); white-space: pre-wrap; }
blockquote { padding-left: 10pt; border-left: 3px solid var(--paper-rule); }
a { color: inherit; }
.diagram-source { display: none; }
`

const absoluteUrls = (css: string, base: string): string =>
  css.replace(/url\("?([^")]+)"?\)/g, (_, url: string) => `url("${new URL(url, base).href}")`)

/**
 * From the app's own styles: the light colour tokens (the first :root, outside the dark
 * media query), KaTeX with its fonts, and the text colours.
 */
function appCss(): string {
  const out: string[] = []
  let root = false
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        if (/katex/i.test(rule.style.getPropertyValue('font-family'))) {
          out.push(absoluteUrls(rule.cssText, sheet.href ?? document.baseURI))
        }
      } else if (rule instanceof CSSStyleRule) {
        if (rule.selectorText === ':root' && !root) {
          root = true
          out.push(rule.cssText)
        } else if (/katex|\.tc-/.test(rule.selectorText)) {
          out.push(rule.cssText)
        }
      }
    }
  }
  return out.join('\n')
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A note as one printable page: math, colours and charts drawn, images from the vault. */
export async function noteHtml(notePath: string, source: string): Promise<string> {
  const root = document.createElement('div')
  root.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 700px'
  root.innerHTML = renderMarkdown(source)
  document.body.append(root)
  try {
    for (const img of root.querySelectorAll('img')) {
      const target = resolveLink(notePath, img.getAttribute('src') ?? '')
      if (target) img.setAttribute('src', vaultUrl(target.path))
    }
    // Links to slides and other notes lead nowhere on paper.
    for (const a of root.querySelectorAll('a[href]')) {
      if (resolveLink(notePath, a.getAttribute('href') ?? '')) a.removeAttribute('href')
    }
    await drawDiagrams(root, 'paper')
    const title = notePath.split('/').pop()!.replace(/\.md$/i, '')
    return (
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
      `<title>${escapeHtml(title)}</title><style>${appCss()}\n${PRINT_CSS}</style></head>` +
      `<body>${root.innerHTML}</body></html>`
    )
  } finally {
    root.remove()
  }
}
