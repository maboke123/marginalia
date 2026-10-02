import { useEffect } from 'react'
import { comboOf, HOTKEY_ACTIONS, type HotkeyAction } from '../../shared/hotkeys'
import { focusChatInput, useChat } from './claude/chat'
import { ClaudePanel } from './claude/ClaudePanel'
import { runTool } from './claude/tools'
import { QuickSwitcher } from './components/QuickSwitcher'
import { SearchPanel } from './components/SearchPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'
import { slideLink } from './editor/links'
import { flushAll } from './lib/flush'
import { indexPdfs } from './lib/indexer'
import { useApp } from './store'

/** Insert current slide link: typed into the summary wherever focus is. */
function insertCurrentSlideLink(): void {
  const { editor, pdfView, showError } = useApp.getState()
  if (!editor) return showError('Open a summary to insert a slide link')
  if (!pdfView) return showError('Open slides to link to the current slide')
  editor.insert(slideLink(editor.path, pdfView.path, pdfView.page))
}

/** Open the Claude panel, go to its input, or close it when already typing there. */
function toggleClaude(): void {
  const { open, setOpen } = useChat.getState()
  const typing = document.activeElement?.closest('.claude-input')
  if (open && typing) {
    setOpen(false)
    return
  }
  setOpen(true)
  focusChatInput()
}

function toggleOverlay(overlay: 'switcher' | 'search' | 'settings'): void {
  const app = useApp.getState()
  app.setOverlay(app.overlay === overlay ? null : overlay)
}

// The slide tools (pen, highlighter, ...) are handled by the slide viewer itself.
const ACTIONS: Partial<Record<HotkeyAction, () => void>> = {
  claude: toggleClaude,
  lecture: () => useApp.getState().toggleLecture(),
  importPdf: () => useApp.getState().importPdfs(),
  slideLink: insertCurrentSlideLink,
  snapshot: () => useApp.getState().startSnapshot(),
  switcher: () => toggleOverlay('switcher'),
  search: () => toggleOverlay('search'),
  settings: () => toggleOverlay('settings')
}

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const vault = useApp((s) => s.vault)
  const lectureMode = useApp((s) => s.lectureMode)
  const overlay = useApp((s) => s.overlay)
  const error = useApp((s) => s.error)
  const notice = useApp((s) => s.notice)
  const showError = useApp((s) => s.showError)
  const claudeOpen = useChat((s) => s.open)

  useEffect(() => {
    useApp.getState().init()
    // Slides added or changed outside the app become searchable a little later.
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = window.api.vault.onChanged(() => {
      useApp.getState().refresh()
      clearTimeout(timer)
      timer = setTimeout(() => void indexPdfs(), 1500)
    })
    return () => {
      clearTimeout(timer)
      stop()
    }
  }, [])

  // Index once a vault is open (also after switching vaults).
  useEffect(() => {
    if (vault) void indexPdfs()
  }, [vault])

  useEffect(
    () =>
      window.api.app.onBeforeClose(async () => {
        await flushAll()
        window.api.app.readyToClose()
      }),
    []
  )

  // Claude's app tools run here, against the open documents.
  useEffect(
    () =>
      window.api.claude.onToolCall(async (call) =>
        window.api.claude.replyTool(await runTool(call))
      ),
    []
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const combo = comboOf(e)
      const { vault, settings } = useApp.getState()
      const { hotkeys } = settings
      if (!combo || !vault) return
      const action = HOTKEY_ACTIONS.find((a) => a.scope === 'global' && hotkeys[a.id] === combo)
      const run = action && ACTIONS[action.id]
      if (!run) return
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    // Capture phase, so the editor's own key bindings (like Ctrl+L) do not see these first.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (!ready) return null

  return (
    <>
      {vault ? (
        <div className="shell">
          <div className="layout">
            {!lectureMode && <Sidebar />}
            <Workspace />
          </div>
          {claudeOpen && <ClaudePanel />}
          {overlay === 'switcher' && <QuickSwitcher />}
          {overlay === 'search' && <SearchPanel />}
          {overlay === 'settings' && <SettingsDialog />}
        </div>
      ) : (
        <Welcome />
      )}
      {(error || notice) && (
        <div className="toast" role={error ? 'alert' : 'status'}>
          <span>{error ?? notice}</span>
          <button className="toast-close" aria-label="Dismiss" onClick={() => showError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </>
  )
}
