import { useApp } from '../store'
import { Icon } from './Icon'

/** At the end of a pane's toolbar. Closing the last file shows the empty view. */
export function CloseButton({ path }: { path: string }): React.JSX.Element {
  const hotkey = useApp((s) => s.settings.hotkeys.close)
  return (
    <button
      className="icon-button"
      title={`Close (${hotkey} closes everything)`}
      aria-label="Close"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => useApp.getState().closeFile(path)}
    >
      <Icon name="close" />
    </button>
  )
}
