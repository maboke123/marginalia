import { syntaxTree } from '@codemirror/language'
import { Facet, StateField, type EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { resolveLink, vaultUrl } from './links'
import { BulletWidget, ImageWidget, MathWidget, RuleWidget, TableWidget } from './widgets'

/**
 * Obsidian-style live preview: Markdown renders in place, and whatever the cursor is on shows
 * its source. Inline things (headings, emphasis, links, inline math) are decorated for the
 * visible part of the note; blocks (tables, display math) need a state field because block
 * widgets cannot come from a view plugin.
 */

/** Vault path of the note being edited, to resolve relative image links. */
export const notePath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })

const hide = Decoration.replace({})

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n)
  }
  return lines
}

function mathSource(state: EditorState, node: SyntaxNodeRef, mark: number): string {
  return state.sliceDoc(node.from + mark, node.to - mark).trim()
}

function inlineDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const active = activeLines(state)
  const note = state.facet(notePath)
  const decos: Range<Decoration>[] = []
  const isActive = (pos: number): boolean => active.has(state.doc.lineAt(pos).number)

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const heading = /^ATXHeading(\d)$/.exec(name)
        if (heading) {
          const line = state.doc.lineAt(node.from)
          decos.push(Decoration.line({ class: `cm-h cm-h${heading[1]}` }).range(line.from))
          return
        }

        switch (name) {
          case 'Table':
          case 'BlockMath':
            return false

          case 'FencedCode': {
            for (let pos = node.from; pos <= node.to;) {
              const line = state.doc.lineAt(pos)
              decos.push(Decoration.line({ class: 'cm-code-block' }).range(line.from))
              pos = line.to + 1
            }
            return false
          }

          case 'Blockquote': {
            for (let pos = node.from; pos <= node.to;) {
              const line = state.doc.lineAt(pos)
              decos.push(Decoration.line({ class: 'cm-quote' }).range(line.from))
              pos = line.to + 1
            }
            return
          }

          case 'HeaderMark':
          case 'QuoteMark': {
            if (isActive(node.from)) return
            // Hide the mark and the space after it.
            const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            decos.push(hide.range(node.from, end))
            return
          }

          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to))
            return

          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) {
              decos.push(hide.range(node.from, node.to))
            }
            return

          case 'Emphasis':
            decos.push(Decoration.mark({ class: 'cm-em' }).range(node.from, node.to))
            return
          case 'StrongEmphasis':
            decos.push(Decoration.mark({ class: 'cm-strong' }).range(node.from, node.to))
            return
          case 'Strikethrough':
            decos.push(Decoration.mark({ class: 'cm-strike' }).range(node.from, node.to))
            return
          case 'InlineCode':
            decos.push(Decoration.mark({ class: 'cm-inline-code' }).range(node.from, node.to))
            return

          case 'ListMark': {
            const bullet = node.node.parent?.parent?.name === 'BulletList'
            if (bullet && !isActive(node.from)) {
              decos.push(
                Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to)
              )
            }
            return
          }

          case 'HorizontalRule':
            if (!isActive(node.from)) {
              decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            }
            return false

          case 'InlineMath': {
            const mark = node.node.firstChild
            const size = mark ? mark.to - mark.from : 1
            // CodeMirror cannot replace text across a line break with an inline widget.
            const oneLine = state.doc.lineAt(node.from).number === state.doc.lineAt(node.to).number
            if (!oneLine || selectionTouches(state, node.from, node.to)) {
              decos.push(Decoration.mark({ class: 'cm-math-source' }).range(node.from, node.to))
            } else {
              const tex = mathSource(state, node, size)
              // $$x$$ inside a line: display style, still inline so the line stays one line.
              const widget = new MathWidget(size === 2 ? `\\displaystyle ${tex}` : tex, false)
              decos.push(Decoration.replace({ widget }).range(node.from, node.to))
            }
            return false
          }

          case 'Image': {
            if (isActive(node.from)) return false
            const url = node.node.getChild('URL')
            if (!url) return false
            const href = state.sliceDoc(url.from, url.to)
            const target = resolveLink(note, href)
            const text = state.sliceDoc(node.from, node.to)
            const alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? ''
            const widget = new ImageWidget(target ? vaultUrl(target.path) : null, alt)
            decos.push(Decoration.replace({ widget }).range(node.from, node.to))
            return false
          }

          case 'Link': {
            if (isActive(node.from)) return
            const marks = node.node.getChildren('LinkMark')
            const url = node.node.getChild('URL')
            if (marks.length < 2 || !url) return
            const textFrom = marks[0].to
            const textTo = marks[1].from
            decos.push(hide.range(node.from, textFrom))
            if (textTo > textFrom) {
              decos.push(
                Decoration.mark({
                  class: 'cm-link-text',
                  attributes: { 'data-href': state.sliceDoc(url.from, url.to) }
                }).range(textFrom, textTo)
              )
            }
            decos.push(hide.range(textTo, node.to))
            return false
          }
        }
        return
      }
    })
  }
  return Decoration.set(decos, true)
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = inlineDecorations(view)
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = inlineDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

function blockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table' && node.name !== 'BlockMath') return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      const editing = selectionTouches(state, from, to)

      if (node.name === 'Table') {
        if (!editing) {
          const widget = new TableWidget(state.sliceDoc(from, to))
          decos.push(Decoration.replace({ widget, block: true }).range(from, to))
        }
        return false
      }

      const closed = node.node.getChildren('MathMark').length > 1
      const tex = state.sliceDoc(node.from + 2, closed ? node.to - 2 : node.to).trim()
      if (editing) {
        // While typing, the rendered formula shows under the source.
        const widget = new MathWidget(tex, true, true)
        decos.push(Decoration.widget({ widget, block: true, side: 1 }).range(to))
      } else {
        const widget = new MathWidget(tex, true)
        decos.push(Decoration.replace({ widget, block: true }).range(from, to))
      }
      return false
    }
  })
  return Decoration.set(decos, true)
}

const blockPreview = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(decos, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return blockDecorations(tr.state)
    }
    return decos
  },
  provide: (field) => EditorView.decorations.from(field)
})

export const livePreview = [inlinePreview, blockPreview]
