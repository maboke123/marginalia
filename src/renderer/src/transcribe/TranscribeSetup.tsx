import { useRecording } from './recording'

const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`

/** The one-time download before the first recording. */
export function TranscribeSetup(): React.JSX.Element | null {
  const setup = useRecording((s) => s.setup)
  if (!setup) return null
  const total = setup.parts.reduce((n, p) => n + setup.sizes[p], 0)
  const done = setup.parts.reduce((n, p) => n + (setup.done[p] ?? 0), 0)
  const close = (): void => {
    if (!setup.installing) useRecording.getState().closeSetup()
  }

  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        className="setup-dialog"
        role="dialog"
        aria-label="Set up speech to text"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2>Speech to text</h2>
        <p>
          Lectures are transcribed on this laptop with whisper.cpp: nothing is sent anywhere and it
          works offline. It needs a one-time download of {mb(total)} (the program and a speech
          model).
        </p>
        <p className="muted">
          Record only where it is allowed. The audio is kept next to the transcript (about 15 MB per
          hour).
        </p>
        {setup.installing && (
          <div
            className="setup-progress"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemax={total}
          >
            <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
        )}
        {setup.installing && (
          <p className="muted">
            {mb(done)} of {mb(total)}
          </p>
        )}
        {setup.error && <p className="setup-error">{setup.error}</p>}
        <div className="setup-actions">
          <button className="text-button" disabled={setup.installing} onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            autoFocus
            disabled={setup.installing}
            onClick={() => void useRecording.getState().install()}
          >
            {setup.error ? 'Try again' : 'Download and start recording'}
          </button>
        </div>
      </div>
    </div>
  )
}
