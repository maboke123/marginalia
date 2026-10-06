import { parentOf } from '../lib/tree'

/** Joins and normalises vault paths ("a/b/../c" -> "a/c"). Returns null if it leaves the vault. */
function normalise(parts: string[]): string | null {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

export interface LinkTarget {
  /** Vault path of the linked file. */
  path: string
  page: number | null
}

/**
 * Resolves a Markdown link in a note to a file in the vault, e.g.
 * `slides.pdf#page=12` in `ML/B2/Summary.md` -> `ML/B2/slides.pdf`, page 12.
 * Returns null for web links and links outside the vault.
 */
export function resolveLink(notePath: string, href: string): LinkTarget | null {
  // `[slide 3](<(les2) slides.pdf#page=3>)`: the angle form allows spaces and parentheses
  const bare = /^<(.*)>$/.exec(href.trim())?.[1] ?? href.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare)) return null
  const [rawPath, hash = ''] = bare.split('#')
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    decoded = rawPath
  }
  const path = normalise([...parentOf(notePath).split('/'), ...decoded.split('/')])
  if (!path) return null
  const page = /(?:^|&)page=(\d+)/.exec(hash)
  return { path, page: page ? Number(page[1]) : null }
}

/** Path from a note's folder to another vault file, URL-encoded for a Markdown link. */
export function relativeHref(notePath: string, target: string): string {
  const from = parentOf(notePath).split('/').filter(Boolean)
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const parts = [...from.slice(common).map(() => '..'), ...to.slice(common)]
  return parts.map(encodeURIComponent).join('/')
}

/** `[slide 12](slides.pdf#page=12)` */
export function slideLink(notePath: string, pdfPath: string, page: number): string {
  return `[slide ${page}](${relativeHref(notePath, pdfPath)}#page=${page})`
}

/** URL the renderer can load an image in the vault from, through the vault:// protocol. */
export function vaultUrl(path: string): string {
  return `vault://local/${path.split('/').map(encodeURIComponent).join('/')}`
}
