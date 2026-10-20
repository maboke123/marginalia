import { useState } from 'react'
import type { RecordSource } from '../../../shared/settings'
import { ContextMenu } from '../components/ContextMenu'
import { Icon } from '../components/Icon'
import { useApp } from '../store'
import { useRecording } from './recording'
import { RecordingClock } from './RecordingBar'

const SOURCES: { value: RecordSource; label: string }[] = [
  { value: 'microphone', label: 'Record the microphone' },
  { value: 'computer', label: 'Record the sound of this computer' }
]

/**
 * Starts or stops recording the lecture; in the sidebar, the slides and the note. With the
 * recording bar hidden, the time shows next to it (not in the narrow sidebar) and brings the
 * bar back. Right-click picks what to record from (a lecture video plays on this computer).
 */
export function RecordButton({ showTime = true }: { showTime?: boolean }): React.JSX.Element {
  const active = useRecording((s) => s.active)
  const hotkey = useApp((s) => s.settings.hotkeys.record)
  const barShown = useApp((s) => s.settings.recordingBar)
  const from = useApp((s) => s.settings.recordFrom)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const what = from === 'computer' ? 'the sound of this computer' : 'the lecture'
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
        title={`${active ? 'Stop recording' : `Record ${what}`} (${hotkey}). Right-click to choose.`}
        aria-label="Record lecture"
        aria-pressed={!!active}
        onClick={() => void useRecording.getState().toggle()}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!active) setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <Icon name="mic" />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={SOURCES.map((s) => ({
            label: s.label,
            hint: s.value === from ? 'last used' : undefined,
            onSelect: () =>
              void useApp
                .getState()
                .saveSettings({ recordFrom: s.value })
                .then(() => useRecording.getState().start(s.value))
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
