import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/** An edit Claude proposes, shown in the note until I accept or reject it. */
export interface PendingEdit {
  from: number
  to: number
  insert: string
  /** The text at from..to when proposed; accepting fails if I changed it meanwhile. */
  original: string
  decide(accept: boolean): void
}

export const setPendingEdit = StateEffect.define<PendingEdit | null>()

class ProposalWidget extends WidgetType {
  constructor(readonly edit: PendingEdit) {
    super()
  }

  eq(other: ProposalWidget): boolean {
    return other.edit === this.edit
  }

  toDOM(): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-proposal'
    const text = document.createElement('div')
    text.className = 'cm-proposal-text'
    text.textContent = this.edit.insert.trim() || '(removes the struck-through text)'
    const actions = document.createElement('div')
    actions.className = 'cm-proposal-actions'
    for (const [label, accept] of [
      ['Accept', true],
      ['Reject', false]
    ] as const) {
      const button = document.createElement('button')
      button.className = accept ? 'button primary' : 'button'
      button.textContent = label
      button.onmousedown = (e) => e.preventDefault()
      button.onclick = () => this.edit.decide(accept)
      actions.append(button)
    }
    box.append(text, actions)
    return box
  }

  ignoreEvent(): boolean {
    return true
  }
}

export const pendingEdit = StateField.define<PendingEdit | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPendingEdit)) return effect.value
    if (!value || !tr.docChanged) return value
    // Keep pointing at the same text while I type elsewhere in the note.
    const from = tr.changes.mapPos(value.from, 1)
    const to = Math.max(from, tr.changes.mapPos(value.to, -1))
    return { ...value, from, to }
  },
  provide: (field) =>
    EditorView.decorations.from(field, (edit): DecorationSet => {
      if (!edit) return Decoration.none
      const ranges: Range<Decoration>[] = []
      if (edit.to > edit.from) {
        ranges.push(Decoration.mark({ class: 'cm-proposal-removed' }).range(edit.from, edit.to))
      }
      ranges.push(
        Decoration.widget({ widget: new ProposalWidget(edit), block: true, side: 1 }).range(edit.to)
      )
      return Decoration.set(ranges, true)
    })
})
