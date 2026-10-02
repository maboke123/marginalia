/**
 * Lower case without accents ("É" -> "e"), keeping every character in place, so an index in
 * the folded text is the same index in the original. Used for search and the quick switcher.
 */
export function fold(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch.charCodeAt(0) < 128) {
      out += ch.toLowerCase()
      continue
    }
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    out += base.length === 1 ? base : ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch
  }
  return out
}
