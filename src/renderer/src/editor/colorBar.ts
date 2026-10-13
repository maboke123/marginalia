import { StateEffect, StateField, type ChangeSpec, type EditorState } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { recolor, TEXT_COLORS, type TextColor } from '../../../shared/textColor'
import { colorLabel } from '../../../shared/types'

/** Colours the selection (null removes the colour). With only a cursor, see `recolor`. */
export function setTextColor(view: EditorView, color: TextColor | null): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  const changes: ChangeSpec[] = []
  let shift = 0
  let anchor: number | null = null
  let head: number | null = null
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n)
    const a = Math.max(from, line.from) - line.from
    const b = Math.min(to, line.to) - line.from
    // A selection over several lines only colours text, not the line breaks.
    const result = a === b && from !== to ? null : recolor(line.text, a, b, color)
    if (result) {
      changes.push({ from: line.from, to: line.to, insert: result.text })
      if (n === first.number) anchor = line.from + shift + result.from
      if (n === last.number) head = line.from + shift + result.to
      shift += result.text.length - line.length
    }
  }
  if (!changes.length) return false
  const set = state.changes(changes)
  view.dispatch({
    changes: set,
    selection: { anchor: anchor ?? set.mapPos(from, 1), head: head ?? set.mapPos(to, -1) },
    userEvent: 'input.color'
  })
  view.focus()
  return true
}

const label = colorLabel

function createBar(view: EditorView): { dom: HTMLElement } {
  const dom = document.createElement('div')
  dom.className = 'cm-color-bar'
  dom.setAttribute('role', 'toolbar')
  dom.setAttribute('aria-label', 'Text colour')
  for (const color of TEXT_COLORS) {
    const button = document.createElement('button')
    button.className = 'cm-color-swatch'
    button.dataset.color = color
    button.title = label(color)
    button.setAttribute('aria-label', `${label(color)} text`)
    button.style.background = `var(--nb-${color})`
    dom.append(button)
  }
  const clear = document.createElement('button')
  clear.className = 'cm-color-clear'
  clear.textContent = 'Clear'
  clear.title = 'Normal text colour'
  dom.append(clear)
  // mousedown, not click: the editor must keep its focus and selection.
  dom.addEventListener('mousedown', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    event.preventDefault()
    if (!button) return
    setTextColor(view, (button.dataset.color as TextColor | undefined) ?? null)
  })
  return { dom }
}

const setDragging = StateEffect.define<boolean>()

/** True while the mouse is selecting, so the bar does not jump along with the drag. */
const dragging = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setDragging)) value = effect.value
    return value
  }
})

function barFor(state: EditorState): Tooltip | null {
  const { main } = state.selection
  if (main.empty || state.field(dragging)) return null
  return { pos: main.from, above: true, create: createBar }
}

const bar = StateField.define<Tooltip | null>({
  create: barFor,
  update(tip, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setDragging))) return tip
    const next = barFor(tr.state)
    // Same spot: keep the element, so it does not flicker while the selection grows.
    return next && tip?.pos === next.pos ? tip : next
  },
  provide: (field) => showTooltip.from(field)
})

/** A row of colours above selected text in a note. */
export const colorBar = [
  dragging,
  bar,
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false
      view.dispatch({ effects: setDragging.of(true) })
      window.addEventListener(
        'mouseup',
        () => view.dom.isConnected && view.dispatch({ effects: setDragging.of(false) }),
        { once: true }
      )
      return false
    }
  })
]
