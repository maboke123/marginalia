import { useEffect, useRef, useState } from 'react'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon } from '../components/Icon'
import { registerFlush } from '../lib/flush'
import { useApp } from '../store'
import { insertText } from './commands'
import { resolveLink } from './links'
import { editorExtensions } from './setup'

/** Marks a change that came from disk, so it is not saved straight back. */
const fromDisk = Annotation.define<boolean>()

export function MarkdownEditor({
  path,
  title
}: {
  path: string
  title: string
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const lectureMode = useApp((s) => s.lectureMode)
  const toggleLecture = useApp((s) => s.toggleLecture)

  useEffect(() => {
    const api = window.api.vault
    const { setEditor, showError, openFile } = useApp.getState()
    let view: EditorView | null = null
    let cancelled = false
    let saved = ''
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const save = async (): Promise<void> => {
      clearTimeout(timer)
      if (!view || !dirty) return
      const text = view.state.doc.toString()
      dirty = false
      try {
        await api.writeText(path, text)
        saved = text
      } catch (err) {
        dirty = true
        showError(`Summary not saved: ${(err as Error).message}`)
      }
    }

    const openLink = (href: string): void => {
      if (/^https?:\/\//i.test(href)) {
        window.open(href)
        return
      }
      const target = resolveLink(path, href)
      if (target) openFile(target.path, target.page ?? undefined)
    }

    api
      .readText(path)
      .then((text) => {
        if (cancelled) return
        saved = text
        view = new EditorView({
          parent: hostRef.current!,
          state: EditorState.create({
            doc: text,
            // During a lecture you mostly add to the end, so that is where the cursor starts.
            selection: { anchor: text.length },
            extensions: [
              editorExtensions({ path, onOpenLink: openLink }),
              EditorView.updateListener.of((update) => {
                if (!update.docChanged) return
                if (update.transactions.every((tr) => tr.annotation(fromDisk))) return
                dirty = true
                clearTimeout(timer)
                timer = setTimeout(save, 1000)
              })
            ]
          })
        })
        setEditor({ path, insert: (t) => view && insertText(view, t) })
        view.focus()
        view.dispatch({ effects: EditorView.scrollIntoView(text.length, { y: 'center' }) })
      })
      .catch((err: Error) => !cancelled && setError(err.message))

    // Edits made elsewhere (Obsidian, Explorer, a sync) come in when there are no unsaved ones here.
    const stopWatching = api.onChanged(async () => {
      if (!view || dirty) return
      const text = await api.readText(path).catch(() => null)
      if (text === null || text === saved || !view) return
      saved = text
      const { head: oldHead } = view.state.selection.main
      const head = oldHead === view.state.doc.length ? text.length : Math.min(oldHead, text.length)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
        annotations: fromDisk.of(true)
      })
    })
    const unregister = registerFlush(save)

    return () => {
      cancelled = true
      stopWatching()
      unregister()
      void save().finally(() => view?.destroy())
      if (useApp.getState().editor?.path === path) setEditor(null)
    }
  }, [path])

  return (
    <div className="md-pane">
      <div className="pane-toolbar">
        <span className="pane-title">{title}</span>
        <button
          className={lectureMode ? 'icon-button pressed' : 'icon-button'}
          title="Lecture mode (Ctrl+Shift+M)"
          aria-label="Lecture mode"
          aria-pressed={lectureMode}
          onClick={() => toggleLecture()}
        >
          <Icon name="columns" />
        </button>
      </div>
      {error ? (
        <p className="pdf-message">Could not open this note: {error}</p>
      ) : (
        <div className="md-editor" ref={hostRef} />
      )}
    </div>
  )
}
