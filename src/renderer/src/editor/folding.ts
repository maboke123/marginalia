import {
  codeFolding,
  ensureSyntaxTree,
  foldable,
  foldedRanges,
  foldEffect,
  foldKeymap,
  syntaxTree,
  unfoldEffect
} from '@codemirror/language'
import { EditorState, type Extension, type StateEffect } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { EditorView, gutter, GutterMarker, keymap } from '@codemirror/view'
import { setPendingEdit, type PendingEdit } from './proposal'

/** Level of the ATX heading on the line starting at `from`, or 0. */
function headingLevel(state: EditorState, from: number): number {
  // resolve, not resolveInner, which would enter the HTML parser mounted on inline tags.
  for (let node: SyntaxNode | null = syntaxTree(state).resolve(from, 1); node; node = node.parent) {
    const match = /^ATXHeading(\d)$/.exec(node.name)
    if (match) return node.from === from ? Number(match[1]) : 0
  }
  return 0
}

function foldAt(state: EditorState, from: number, to: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null
  foldedRanges(state).between(from, to, (a, b) => {
    if (a >= from && a <= to) found = { from: a, to: b }
  })
  return found
}

const CHEVRON = 'M6 4l4 4-4 4'

class FoldMarker extends GutterMarker {
  constructor(
    readonly level: number,
    readonly open: boolean
  ) {
    super()
    // The heading's own classes give the marker its line's size; level 0 is the spacer.
    if (level) this.elementClass = `cm-h cm-h${level}${open ? '' : ' cm-folded'}`
  }

  eq(other: FoldMarker): boolean {
    return other.level === this.level && other.open === this.open
  }

  toDOM(): Node {
    const box = document.createElement('span')
    box.className = 'cm-fold-marker'
    box.title = this.open ? 'Fold section' : 'Unfold section'
    box.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="${CHEVRON}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    return box
  }
}

/** A chevron next to each heading that hides its section, up to the next heading as high. */
const headingFoldGutter = gutter({
  class: 'cm-foldGutter',
  lineMarker(view, line) {
    const level = headingLevel(view.state, line.from)
    if (!level) return null
    if (foldAt(view.state, line.from, line.to)) return new FoldMarker(level, false)
    const first = view.state.doc.lineAt(line.from)
    return foldable(view.state, first.from, first.to) ? new FoldMarker(level, true) : null
  },
  lineMarkerChange: (update) =>
    update.docChanged ||
    update.viewportChanged ||
    foldedRanges(update.startState) !== foldedRanges(update.state) ||
    syntaxTree(update.startState) !== syntaxTree(update.state),
  initialSpacer: () => new FoldMarker(0, true),
  domEventHandlers: {
    click(view, line) {
      const folded = foldAt(view.state, line.from, line.to)
      if (folded) {
        view.dispatch({ effects: unfoldEffect.of(folded) })
        return true
      }
      const first = view.state.doc.lineAt(line.from)
      const range = foldable(view.state, first.from, first.to)
      if (!range) return false
      view.dispatch({ effects: foldEffect.of(range) })
      return true
    }
  }
})

/** Opens a folded section when text changes inside it or Claude proposes an edit there. */
const unfoldOnChange = EditorState.transactionExtender.of((tr) => {
  const proposals: PendingEdit[] = []
  for (const e of tr.effects) if (e.is(setPendingEdit) && e.value) proposals.push(e.value)
  if (!tr.docChanged && !proposals.length) return null
  const folds = foldedRanges(tr.startState).map(tr.changes)
  const effects: StateEffect<unknown>[] = []
  const open = (fromB: number, toB: number, edges: boolean): void => {
    folds.between(fromB, toB, (from, to) => {
      const inside = edges ? from <= toB && to >= fromB : from < toB && to > fromB
      if (inside) effects.push(unfoldEffect.of({ from, to }))
    })
  }
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => open(fromB, toB, false))
  // Including the edges: a proposal at the very end of a section would show behind the "…".
  for (const edit of proposals) open(edit.from, edit.to, true)
  return effects.length ? { effects } : null
})

export const headingFolding: Extension = [
  codeFolding({ placeholderText: '…' }),
  unfoldOnChange,
  headingFoldGutter,
  keymap.of(foldKeymap)
]

// Folds are a per-machine view setting like expanded folders, so they live in localStorage.
// Storage can be unavailable; folding still works, it is just not remembered.
export function loadFolds(key: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(list) ? list.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function saveFolds(key: string, titles: string[]): void {
  try {
    if (titles.length) localStorage.setItem(key, JSON.stringify(titles))
    else localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

/** Heading lines of the folded sections, to fold them again next time. */
export function foldedHeadings(state: EditorState): string[] {
  const titles: string[] = []
  foldedRanges(state).between(0, state.doc.length, (from) => {
    titles.push(state.doc.lineAt(from).text)
  })
  return titles
}

/** Folds the headings with these titles again, except the section the cursor is in. */
export function refold(view: EditorView, titles: string[]): void {
  if (!titles.length) return
  // Headings further down may not be parsed yet; the next state picks up the parsed tree.
  ensureSyntaxTree(view.state, view.state.doc.length, 200)
  view.dispatch({})
  const { state } = view
  const wanted = new Set(titles)
  const head = state.selection.main.head
  const effects: StateEffect<unknown>[] = []
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n)
    if (!wanted.has(line.text) || !headingLevel(state, line.from)) continue
    const range = foldable(state, line.from, line.to)
    if (range && !(range.from <= head && head <= range.to)) effects.push(foldEffect.of(range))
  }
  if (effects.length) view.dispatch({ effects })
}
