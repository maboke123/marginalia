import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'

/** Where I am, so a note about a problem says where it happened. */
function currentContext(): string | undefined {
  const { lectureMode, activeFile, slidesFile, summaryFile, pdfView } = useApp.getState()
  const files = lectureMode ? [slidesFile, summaryFile] : [activeFile]
  const parts = files
    .filter(Boolean)
    .map((f) => (pdfView && f === pdfView.path ? `${f}, page ${pdfView.page}` : f!))
  if (lectureMode) parts.push('lecture mode')
  return parts.join(' · ') || undefined
}

/** Bottom of the sidebar: jot down what went wrong or should change, saved to feedback.md. */
export function FeedbackBox(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const { showError, showNotice } = useApp.getState()

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])

  async function save(): Promise<void> {
    if (!text.trim() || saving) return
    setSaving(true)
    try {
      await window.api.app.saveFeedback({ text, context: currentContext() })
      setText('')
      setOpen(false)
      showNotice('Feedback saved')
    } catch (err) {
      showError(`Feedback not saved: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="feedback">
      {open && (
        <div className="feedback-box" role="dialog" aria-label="Feedback">
          <textarea
            ref={ref}
            value={text}
            placeholder="What went wrong, or what should change?"
            spellCheck
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault()
                save()
              }
            }}
          />
          <div className="feedback-actions">
            <button
              className="text-button"
              onClick={() =>
                window.api.app.openFeedback().catch((err: Error) => showError(err.message))
              }
            >
              Open list
            </button>
            <button
              className="button primary"
              disabled={!text.trim() || saving}
              title="Save (Ctrl+Enter)"
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <button
        className={open ? 'text-button pressed' : 'text-button'}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Feedback
      </button>
    </div>
  )
}
