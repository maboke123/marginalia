import { isolateHistory } from '@codemirror/commands'
import { StateEffect, StateField, Transaction, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type Command,
  type DecorationSet
} from '@codemirror/view'
import { buildPacket } from '../claude/context'
import { parentOf } from '../lib/tree'
import { useApp } from '../store'
import { notePath } from './livePreview'
import { headingPath, textAround } from './sections'

// "/claude <what to write>" + Enter in a note: Claude's answer replaces that text, as one
// undo step, so Ctrl+Z brings the request back to rephrase it.

interface Pending {
  from: number
  to: number
}

const start = StateEffect.define<Pending>()
const finish = StateEffect.define<null>()

class WritingWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-claude-writing'
    span.textContent = 'Claude is writing... Esc cancels'
    return span
  }
}

export const inlineRequest = StateField.define<Pending | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(start)) return effect.value
      if (effect.is(finish)) return null
    }
    if (!value || !tr.docChanged) return value
    // Follows the request while I keep typing elsewhere in the note.
    const from = tr.changes.mapPos(value.from, 1)
    return { from, to: Math.max(from, tr.changes.mapPos(value.to, -1)) }
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      if (!value) return Decoration.none
      const ranges: Range<Decoration>[] = [
        Decoration.mark({ class: 'cm-claude-request' }).range(value.from, value.to),
        Decoration.widget({ widget: new WritingWidget(), side: 1 }).range(value.to)
      ]
      return Decoration.set(ranges)
    })
})

/** The last "/claude <request>" on a line: an earlier one is text I kept, not this request. */
function findRequest(text: string): { at: number; ask: string } | null {
  let found: { at: number; ask: string } | null = null
  for (const m of text.matchAll(/(^|\s)\/claude\s+/gi)) {
    const ask = text.slice(m.index + m[0].length).trim()
    if (ask) found = { at: m.index + m[1].length, ask }
  }
  return found
}

/** Claude sometimes wraps its answer in a code fence anyway; the note wants the content. */
function unwrap(text: string): string {
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text.trim())
  return (fenced ? fenced[1] : text).trim()
}

/**
 * The request being prepared or answered. Esc can come while the slide image is still being
 * rendered, before main knows about the request, so cancelling is tracked here too.
 */
let current: { view: EditorView; cancelled: boolean } | null = null

class Cancelled extends Error {}

async function request(view: EditorView, from: number, to: number, ask: string): Promise<void> {
  const mine = { view, cancelled: false }
  current = mine
  const { pdfView, showError } = useApp.getState()
  const path = view.state.facet(notePath)
  const original = view.state.sliceDoc(from, to)
  const doc = view.state.doc.toString()
  const marked = doc.slice(0, from) + '⟦here⟧' + doc.slice(to)
  const headings = headingPath(doc, from)

  try {
    // The slide on screen comes along, so "the formula on this slide" works.
    const slides = pdfView
      ? await buildPacket(parentOf(path), [{ id: 'slides', label: '', title: '' }], '', null)
      : null
    const text = [
      slides?.text.trim() ?? '',
      `I am writing in my note ${path}${headings.length ? `, under ${headings.join(' > ')}` : ''}.`,
      'Here is the note around the spot; ⟦here⟧ marks where your text goes:',
      `<note>\n${textAround(marked, from)}\n</note>`,
      `What to write at ⟦here⟧: ${ask}`
    ]
      .filter(Boolean)
      .join('\n\n')
    if (mine.cancelled) throw new Cancelled()
    const answer = unwrap(await window.api.claude.complete({ text, images: slides?.images ?? [] }))
    if (mine.cancelled) throw new Cancelled()

    const pending = view.dom.isConnected ? view.state.field(inlineRequest, false) : null
    if (!pending) return
    if (view.state.sliceDoc(pending.from, pending.to) !== original) {
      view.dispatch({ effects: finish.of(null) })
      showError('The /claude request was changed while Claude wrote; nothing was inserted')
      return
    }
    view.dispatch({
      changes: { from: pending.from, to: pending.to, insert: answer },
      effects: finish.of(null),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.claude')]
    })
  } catch (err) {
    if (view.dom.isConnected) view.dispatch({ effects: finish.of(null) })
    const message = (err as Error).message
    if (!(err instanceof Cancelled) && !mine.cancelled && message !== 'Cancelled') {
      showError(`Claude could not write here: ${message}`)
    }
  } finally {
    if (current === mine) current = null
  }
}

/** Enter at the end of a line with "/claude ..." sends the request. */
export const claudeEnter: Command = (view) => {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const found = head === line.to ? findRequest(line.text) : null
  if (!found) return false
  if (view.state.field(inlineRequest, false)) {
    useApp.getState().showError('Claude is still writing in this note')
    return true
  }
  const from = line.from + found.at
  view.dispatch({ effects: start.of({ from, to: line.to }) })
  void request(view, from, line.to, found.ask)
  return true
}

/** Esc while Claude writes cancels the request. */
export const claudeEscape: Command = (view) => {
  if (!view.state.field(inlineRequest, false)) return false
  if (current?.view === view) current.cancelled = true
  view.dispatch({ effects: finish.of(null) })
  void window.api.claude.cancelComplete()
  return true
}
