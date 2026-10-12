/**
 * The text of a selection with every formula as its LaTeX source ($...$, $$...$$ for display
 * math). Plain toString() gives KaTeX's MathML and HTML letters one per line.
 */
export function selectedText(range: Range): string {
  const fragment = range.cloneContents()
  for (const katex of fragment.querySelectorAll('.katex')) {
    const tex = katex.querySelector('annotation')?.textContent
    if (tex === undefined || tex === null) continue
    const display = !!katex.closest('.katex-display')
    katex.replaceWith(display ? `$$${tex}$$` : `$${tex}$`)
  }
  const box = document.createElement('div')
  box.append(fragment)
  // innerText needs layout to keep line breaks between paragraphs.
  box.style.cssText = 'position: fixed; left: -10000px; white-space: pre-wrap'
  document.body.append(box)
  const text = box.innerText
  box.remove()
  return text.trim()
}
