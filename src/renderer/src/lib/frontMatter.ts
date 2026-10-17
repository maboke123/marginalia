/**
 * Pandoc's YAML block at the top of a note (title, author, date, lang, geometry, fontsize).
 * Only flat `key: value` lines; anything else in the block is ignored.
 */
export function frontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match) return { meta: {}, body: source }
  const meta: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (!pair) continue
    meta[pair[1]] = pair[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return { meta, body: source.slice(match[0].length) }
}

const LENGTH = /^\d+(\.\d+)?(cm|mm|in|pt)$/

/** `geometry: margin=1.8cm` -> `1.8cm`; null when absent or not a plain length. */
export function pageMargin(meta: Record<string, string>): string | null {
  const margin = /(?:^|,)\s*margin=([^,\s]+)/.exec(meta.geometry ?? '')?.[1] ?? ''
  return LENGTH.test(margin) ? margin : null
}

/** `fontsize: 10pt`; null when absent or not a plain length. */
export function fontSize(meta: Record<string, string>): string | null {
  return LENGTH.test(meta.fontsize ?? '') ? meta.fontsize : null
}

/** Pandoc's `{width=49%}` after an image: the CSS it sets, and how many characters it took. */
export function imageAttributes(text: string): { style: string; length: number } | null {
  const match = /^\{([^}]*)\}/.exec(text)
  if (!match) return null
  const style: string[] = []
  for (const [, key, , value] of match[1].matchAll(
    /(width|height)=("?)([\d.]+(?:%|px|cm|mm|in|pt)?)\2/g
  )) {
    style.push(`${key}: ${/^[\d.]+$/.test(value) ? `${value}px` : value}`)
  }
  return { style: style.join('; '), length: match[0].length }
}
