import { Icon } from '../components/Icon'
import { useApp } from '../store'
import { useRecording } from './recording'

/** Starts or stops recording the lecture; in the sidebar, the slides and the note. */
export function RecordButton(): React.JSX.Element {
  const recording = useRecording((s) => !!s.active)
  const hotkey = useApp((s) => s.settings.hotkeys.record)
  return (
    <button
      className={recording ? 'icon-button pressed' : 'icon-button'}
      title={`${recording ? 'Stop recording' : 'Record the lecture'} (${hotkey})`}
      aria-label="Record lecture"
      aria-pressed={recording}
      onClick={() => void useRecording.getState().toggle()}
    >
      <Icon name="mic" />
    </button>
  )
}
