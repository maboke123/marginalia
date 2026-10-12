import type { MarkdownConfig } from '@lezer/markdown'

const DOLLAR = 36
const BACKSLASH = 92
const SPACE = 32
const NEWLINE = 10

/**
 * $inline$ and $$display$$ math for the Markdown parser, following Obsidian (and Pandoc):
 * `$` must hug its content, so "costs $5 and $10" is not math.
 */
export const mathSyntax: MarkdownConfig = {
  defineNodes: [{ name: 'BlockMath', block: true }, { name: 'InlineMath' }, { name: 'MathMark' }],

  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      // Like a code fence, $$ may follow a line of text directly ("The risk:\n$$\n...").
      endLeaf: (_cx, line) => line.text.slice(line.pos, line.pos + 2) === '$$',
      parse(cx, line) {
        if (line.text.slice(line.pos, line.pos + 2) !== '$$') return false
        const start = cx.lineStart + line.pos
        const marks = [cx.elt('MathMark', start, start + 2)]

        // $$ on one line: $$ x^2 $$
        const close = line.text.indexOf('$$', line.pos + 2)
        if (close >= 0) {
          const end = cx.lineStart + close + 2
          marks.push(cx.elt('MathMark', end - 2, end))
          cx.nextLine()
          cx.addElement(cx.elt('BlockMath', start, end, marks))
          return true
        }

        let end = -1
        while (cx.nextLine()) {
          const at = line.text.indexOf('$$')
          if (at >= 0) {
            end = cx.lineStart + at + 2
            marks.push(cx.elt('MathMark', end - 2, end))
            cx.nextLine()
            break
          }
        }
        // Still being typed: the block runs to the end of the note.
        if (end < 0) end = cx.prevLineEnd()
        cx.addElement(cx.elt('BlockMath', start, end, marks))
        return true
      }
    }
  ],

  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1
        // $$x$$ inside a line is display math written inline; it may have spaces inside.
        const double = cx.char(pos + 1) === DOLLAR
        const open = double ? 2 : 1
        const first = cx.char(pos + open)
        if (first < 0 || first === NEWLINE || first === DOLLAR || (!double && first === SPACE)) {
          return -1
        }
        const end = cx.offset + cx.text.length
        for (let i = pos + open; i < end; i++) {
          const c = cx.char(i)
          // Never across a line break: CodeMirror cannot draw a widget over one, and a lone
          // $ at the end of a line would otherwise pair with one on the next line.
          if (c === NEWLINE) return -1
          if (c === BACKSLASH) {
            i++
          } else if (double && c === DOLLAR && cx.char(i + 1) === DOLLAR && i > pos + 2) {
            return cx.addElement(
              cx.elt('InlineMath', pos, i + 2, [
                cx.elt('MathMark', pos, pos + 2),
                cx.elt('MathMark', i, i + 2)
              ])
            )
          } else if (!double && c === DOLLAR && i > pos + 1 && cx.char(i - 1) !== SPACE) {
            return cx.addElement(
              cx.elt('InlineMath', pos, i + 1, [
                cx.elt('MathMark', pos, pos + 1),
                cx.elt('MathMark', i, i + 1)
              ])
            )
          }
        }
        return -1
      }
    }
  ]
}
