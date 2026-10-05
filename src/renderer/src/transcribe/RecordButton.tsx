import { Icon } from '../components/Icon'
import { useApp } from '../store'
import { useRecording } from './recording'
import { RecordingClock } from './RecordingBar'

/**
 * Starts or stops recording the lecture; in the sidebar, the slides and the note. With the
 * recording bar hidden, the time shows next to it (not in the narrow sidebar) and brings the
 * bar back.
 */
export function RecordButton({ showTime = true }: { showTime?: boolean }): React.JSX.Element {
  const active = useRecording((s) => s.active)
  const hotkey = useApp((s) => s.settings.hotkeys.record)
  const barShown = useApp((s) => s.settings.recordingBar)
  return (
    <>
      {showTime && active && !barShown && (
        <button
          className="text-button recording-chip"
          title="Show the recording bar"
          onClick={() => void useApp.getState().saveSettings({ recordingBar: true })}
        >
          <span className="recording-dot" aria-hidden />
          <RecordingClock startedAt={active.startedAt} />
        </button>
      )}
      <button
        className={active ? 'icon-button pressed' : 'icon-button'}
        title={`${active ? 'Stop recording' : 'Record the lecture'} (${hotkey})`}
        aria-label="Record lecture"
        aria-pressed={!!active}
        onClick={() => void useRecording.getState().toggle()}
      >
        <Icon name="mic" />
      </button>
    </>
  )
}
