import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'
import { slideLink } from './editor/links'
import { flushAll } from './lib/flush'
import { useApp } from './store'

/** Ctrl+Shift+L: a link to the slide on screen, typed into the summary wherever focus is. */
function insertCurrentSlideLink(): void {
  const { editor, pdfView, showError } = useApp.getState()
  if (!editor) return showError('Open a summary to insert a slide link')
  if (!pdfView) return showError('Open slides to link to the current slide')
  editor.insert(slideLink(editor.path, pdfView.path, pdfView.page))
}

// Ctrl+Shift+ these keys work everywhere, also while typing in the editor.
const HOTKEYS: Record<string, () => void> = {
  KeyI: () => useApp.getState().importPdfs(),
  KeyM: () => useApp.getState().toggleLecture(),
  KeyL: insertCurrentSlideLink,
  KeyS: () => useApp.getState().startSnapshot()
}

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const vault = useApp((s) => s.vault)
  const lectureMode = useApp((s) => s.lectureMode)
  const error = useApp((s) => s.error)
  const showError = useApp((s) => s.showError)

  useEffect(() => {
    useApp.getState().init()
    return window.api.vault.onChanged(() => useApp.getState().refresh())
  }, [])

  useEffect(
    () =>
      window.api.app.onBeforeClose(async () => {
        await flushAll()
        window.api.app.readyToClose()
      }),
    []
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const action = e.ctrlKey && e.shiftKey && !e.altKey ? HOTKEYS[e.code] : undefined
      if (!action || !useApp.getState().vault) return
      e.preventDefault()
      e.stopPropagation()
      action()
    }
    // Capture phase, so the editor's own key bindings do not see these first.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (!ready) return null

  return (
    <>
      {vault ? (
        <div className="layout">
          {!lectureMode && <Sidebar />}
          <Workspace />
        </div>
      ) : (
        <Welcome />
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => showError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
