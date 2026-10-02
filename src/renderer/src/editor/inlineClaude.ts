import { isolateHistory } from '@codemirror/commands'
import { StateEffect, StateField, Transaction, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type Command,
  type DecorationSet
} from '@codemirror/view'
import { Cancelled, cancelWrite, findRequest, newRequestId, writeWithClaude } from '../claude/write'
import { useApp } from '../store'
import { notePath } from './livePreview'
import { headingPath, textAround } from './sections'

// "/claude <what to write>" + Enter in a note: Claude's answer replaces that text, as one
// undo step, so Ctrl+Z brings the request back to rephrase it. Several can run at once.

interface Pending {
  id: string
  from: number
  to: number
}

const start = StateEffect.define<Pending>()
const finish = StateEffect.define<string>()

class WritingWidget extends WidgetType {
  constructor(readonly id: string) {
    super()
  }

  eq(other: WritingWidget): boolean {
    return other.id === this.id
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-claude-writing'
    span.textContent = 'Claude is writing... '
    const cancel = document.createElement('button')
    cancel.className = 'cm-claude-cancel'
    cancel.textContent = 'Cancel'
    cancel.onmousedown = (e) => e.preventDefault()
    cancel.onclick = () => stop(view, this.id)
    span.append(cancel)
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

export const inlineRequests = StateField.define<Pending[]>({
  create: () => [],
  update(value, tr) {
    let next = value
    if (tr.docChanged && next.length) {
      // Each request follows its text while I keep typing elsewhere in the note.
      next = next.map((p) => {
        const from = tr.changes.mapPos(p.from, 1)
        return { ...p, from, to: Math.max(from, tr.changes.mapPos(p.to, -1)) }
      })
    }
    for (const effect of tr.effects) {
      if (effect.is(start)) next = [...next, effect.value]
      if (effect.is(finish)) next = next.filter((p) => p.id !== effect.value)
    }
    return next
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value): DecorationSet => {
      const ranges: Range<Decoration>[] = []
      for (const p of value) {
        ranges.push(
          Decoration.mark({ class: 'cm-claude-request' }).range(p.from, p.to),
          Decoration.widget({ widget: new WritingWidget(p.id), side: 1 }).range(p.to)
        )
      }
      return Decoration.set(ranges, true)
    })
})

function stop(view: EditorView, id: string): void {
  cancelWrite(id)
  view.dispatch({ effects: finish.of(id) })
}

async function request(view: EditorView, pending: Pending, ask: string): Promise<void> {
  const { pdfView, showError } = useApp.getState()
  const path = view.state.facet(notePath)
  const original = view.state.sliceDoc(pending.from, pending.to)
  const doc = view.state.doc.toString()
  const marked = doc.slice(0, pending.from) + '⟦here⟧' + doc.slice(pending.to)
  const headings = headingPath(doc, pending.from)
  const done = (): void => {
    if (view.dom.isConnected) view.dispatch({ effects: finish.of(pending.id) })
  }

  try {
    const answer = await writeWithClaude({
      id: pending.id,
      where: `my note ${path}${headings.length ? `, under ${headings.join(' > ')}` : ''}`,
      around: textAround(marked, pending.from),
      ask,
      // The slide on screen comes along, so "the formula on this slide" works.
      slide: pdfView ? { path: pdfView.path, page: pdfView.page } : undefined
    })
    const now = view.dom.isConnected
      ? view.state.field(inlineRequests, false)?.find((p) => p.id === pending.id)
      : undefined
    if (!now) return
    if (view.state.sliceDoc(now.from, now.to) !== original) {
      done()
      showError('A /claude request was changed while Claude wrote; nothing was inserted')
      return
    }
    view.dispatch({
      changes: { from: now.from, to: now.to, insert: answer },
      effects: finish.of(pending.id),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.claude')]
    })
  } catch (err) {
    done()
    if (!(err instanceof Cancelled)) {
      showError(`Claude could not write here: ${(err as Error).message}`)
    }
  }
}

/** Enter at the end of a line with "/claude ..." sends the request. */
export const claudeEnter: Command = (view) => {
  const head = view.state.selection.main.head
  const line = view.state.doc.lineAt(head)
  const found = head === line.to ? findRequest(line.text) : null
  if (!found) return false
  const from = line.from + found.at
  const busy = view.state.field(inlineRequests, false) ?? []
  // On a request that is already running, Enter is just a new line.
  if (busy.some((p) => p.from < line.to && p.to > from)) return false
  const pending = { id: newRequestId(), from, to: line.to }
  // Send it and go on to a new line, so I can keep writing while Claude works.
  view.dispatch({
    changes: { from: line.to, insert: '\n' },
    selection: { anchor: line.to + 1 },
    effects: start.of(pending),
    scrollIntoView: true,
    userEvent: 'input'
  })
  void request(view, pending, found.ask)
  return true
}

/** Esc cancels the request started last. */
export const claudeEscape: Command = (view) => {
  const busy = view.state.field(inlineRequests, false) ?? []
  const last = busy[busy.length - 1]
  if (!last) return false
  stop(view, last.id)
  return true
}
