import { useEffect, useRef, useState } from 'react'
import { foldedRanges } from '@codemirror/language'
import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Icon } from '../components/Icon'
import { NoteSwitcher } from '../components/NoteSwitcher'
import { CloseButton } from '../components/CloseButton'
import { SidebarButton } from '../components/SidebarButton'
import { registerFlush } from '../lib/flush'
import { findNode } from '../lib/tree'
import { registerNote } from '../lib/open'
import { useApp } from '../store'
import { RecordButton } from '../transcribe/RecordButton'
import { useRecording } from '../transcribe/recording'
import { insertText } from './commands'
import { foldedHeadings, loadFolds, refold, saveFolds } from './folding'
import { resolveLink } from './links'
import { headingPath } from './sections'
import { editorExtensions } from './setup'
import { readZoom, saveZoom, zoomByWheel, zoomStep } from './zoom'

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
  const slidesFile = useApp((s) => s.slidesFile)
  const toggleLecture = useApp((s) => s.toggleLecture)
  const beingWritten = useRecording((s) => s.active?.transcript === path)
  const [zoom, setZoom] = useState(readZoom)

  useEffect(() => saveZoom(zoom), [zoom])

  // Ctrl+wheel is attached by hand: React's wheel listener is passive and cannot stop the
  // page zoom (same as the PDF viewer).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      setZoom((z) => zoomByWheel(z, e.deltaY))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  const onZoomKey = (e: React.KeyboardEvent): void => {
    if (!e.ctrlKey) return
    if (e.key === '+' || e.key === '=') setZoom((z) => zoomStep(z, 1))
    else if (e.key === '-') setZoom((z) => zoomStep(z, -1))
    else if (e.key === '0') setZoom(1)
    else return
    e.preventDefault()
  }

  useEffect(() => {
    const api = window.api.vault
    const { setEditor, showError, openFile, setNoteCursor } = useApp.getState()
    let view: EditorView | null = null
    let unregisterNote = (): void => {}
    let cancelled = false
    let saved = ''
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // A transcript being recorded is written by the app; edits here would be lost when the
    // next part comes in, so it is read-only until the recording stops.
    const lock = new Compartment()
    const locked = (): boolean => useRecording.getState().active?.transcript === path
    const lockedBy = (on: boolean): Extension => [
      EditorState.readOnly.of(on),
      EditorView.editable.of(!on)
    ]

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

    const foldsKey = `folds:${useApp.getState().vault?.root}:${path}`
    let lastFolds = ''
    const rememberFolds = (state: EditorState): void => {
      const titles = foldedHeadings(state)
      const key = JSON.stringify(titles)
      if (key === lastFolds) return
      lastFolds = key
      saveFolds(foldsKey, titles)
    }

    let lastCursor = ''
    const publishCursor = (state: EditorState): void => {
      const { from, to, head } = state.selection.main
      const cursor = {
        path,
        headings: headingPath(state.doc.toString(), head),
        selection: state.sliceDoc(from, Math.min(to, from + 4000))
      }
      // Only publish real changes; most keystrokes do not move to another heading.
      const key = JSON.stringify(cursor)
      if (key === lastCursor) return
      lastCursor = key
      setNoteCursor(cursor)
    }

    const openLink = (href: string): void => {
      if (/^https?:\/\//i.test(href)) {
        window.open(href)
        return
      }
      const target = resolveLink(path, href)
      if (!target) return
      if (findNode(useApp.getState().nodes, target.path))
        openFile(target.path, target.page ?? undefined)
      else showError(`Link target not found: ${target.path}`)
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
              lock.of(lockedBy(locked())),
              EditorView.updateListener.of((update) => {
                if (update.docChanged || update.selectionSet) publishCursor(update.state)
                if (foldedRanges(update.state) !== foldedRanges(update.startState)) {
                  rememberFolds(update.state)
                }
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
        const goto = useApp.getState().noteGoto
        if (goto?.path === path) goToLine(goto.line)
        unregisterNote = registerNote({ path, view })
        refold(view, loadFolds(foldsKey))
        publishCursor(view.state)
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
      // Replacing the whole text drops the folds; fold the same headings again.
      const folds = foldedHeadings(view.state)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
        annotations: fromDisk.of(true)
      })
      refold(view, folds)
    })
    const unregister = registerFlush(save)
    const stopLock = useRecording.subscribe((state, previous) => {
      const was = previous.active?.transcript === path
      if ((state.active?.transcript === path) !== was) {
        view?.dispatch({ effects: lock.reconfigure(lockedBy(locked())) })
      }
    })

    // A search result in this note: put the cursor at the start of its paragraph.
    const goToLine = (line: number): void => {
      if (!view) return
      const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
      view.dispatch({
        selection: { anchor: target.from },
        effects: EditorView.scrollIntoView(target.from, { y: 'center' })
      })
      view.focus()
    }
    const stopGoto = useApp.subscribe((state, previous) => {
      const goto = state.noteGoto
      if (goto && goto !== previous.noteGoto && goto.path === path) goToLine(goto.line)
    })

    return () => {
      cancelled = true
      stopGoto()
      stopLock()
      unregisterNote()
      if (useApp.getState().noteCursor?.path === path) setNoteCursor(null)
      stopWatching()
      unregister()
      void save().finally(() => view?.destroy())
      if (useApp.getState().editor?.path === path) setEditor(null)
    }
  }, [path])

  return (
    <div className="md-pane">
      <div className="pane-toolbar">
        <SidebarButton />
        {lectureMode && slidesFile ? (
          <NoteSwitcher path={path} title={title} />
        ) : (
          <span className="pane-title">{title}</span>
        )}
        {beingWritten && <span className="muted pane-note">Being written while you record</span>}
        <RecordButton />
        <button
          className="icon-button"
          title="See how the note looks as a PDF"
          aria-label="Preview as PDF"
          onClick={() => useApp.getState().showPreview(path)}
        >
          <Icon name="pdf" />
        </button>
        <button
          className="icon-button"
          title="Export this note as a PDF"
          aria-label="Export as PDF"
          onClick={() => useApp.getState().exportNote(path)}
        >
          <Icon name="export" />
        </button>
        <button
          className={lectureMode ? 'icon-button pressed' : 'icon-button'}
          title={`Lecture mode (${useApp.getState().settings.hotkeys.lecture})`}
          aria-label="Lecture mode"
          aria-pressed={lectureMode}
          onClick={() => toggleLecture()}
        >
          <Icon name="columns" />
        </button>
        <CloseButton path={path} />
      </div>
      {error ? (
        <p className="pdf-message">Could not open this note: {error}</p>
      ) : (
        <div
          className="md-editor"
          ref={hostRef}
          style={{ '--note-zoom': zoom } as React.CSSProperties}
          onKeyDown={onZoomKey}
        />
      )}
    </div>
  )
}
