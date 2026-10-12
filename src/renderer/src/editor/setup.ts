import { autocompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Prec, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { editorKeymap, insertImageFiles, slashCommands } from './commands'
import { headingFolding } from './folding'
import { livePreview, notePath } from './livePreview'
import { mathSyntax } from './mathSyntax'
import { claudeChanges, claudeEscape, inlineRequests } from './inlineClaude'
import { pendingEdit } from './proposal'

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.url, class: 'cm-md-url' },
  { tag: tags.monospace, class: 'cm-md-code' },
  { tag: tags.processingInstruction, class: 'cm-md-mark' },
  { tag: tags.quote, class: 'cm-md-quote' }
])

export interface EditorOptions {
  path: string
  onOpenLink(href: string): void
}

export function editorExtensions({ path, onOpenLink }: EditorOptions): Extension[] {
  return [
    // First of all: autocomplete also binds Esc at the highest precedence and would take it
    // while it holds a stale result, so a running /claude request could not be cancelled.
    Prec.highest(keymap.of([{ key: 'Escape', run: claudeEscape }])),
    notePath.of(path),
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    // Before markdown(): its keymap has the same precedence, and its Enter continues lists, so
    // "- item /claude ..." would never be sent.
    Prec.high(keymap.of(editorKeymap)),
    markdown({ base: markdownLanguage, extensions: [mathSyntax] }),
    syntaxHighlighting(highlight),
    livePreview,
    headingFolding,
    pendingEdit,
    inlineRequests,
    claudeChanges,
    autocompletion({ override: [slashCommands], icons: false }),
    placeholder('Type / for headings, tables, math, slides and Claude'),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    EditorView.domEventHandlers({
      mousedown(event) {
        const link = (event.target as HTMLElement).closest<HTMLElement>('.cm-link-text')
        if (!link || event.button !== 0 || !link.dataset.href) return false
        event.preventDefault()
        onOpenLink(link.dataset.href)
        return true
      },
      paste(event, view) {
        const files = [...(event.clipboardData?.files ?? [])]
        const pos = view.state.selection.main.from
        if (!insertImageFiles(view, files, pos)) return false
        event.preventDefault()
        return true
      },
      drop(event, view) {
        const files = [...(event.dataTransfer?.files ?? [])]
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null || !insertImageFiles(view, files, pos)) return false
        // Keep the workspace from treating the image as a PDF to import.
        event.preventDefault()
        event.stopPropagation()
        return true
      }
    })
  ]
}
