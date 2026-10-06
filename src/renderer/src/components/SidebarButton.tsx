import { useApp } from '../store'
import { Icon } from './Icon'

/** At the start of a pane's toolbar while the sidebar is hidden, to bring it back. */
export function SidebarButton(): React.JSX.Element | null {
  const hidden = useApp((s) => s.sidebarHidden && !s.lectureMode)
  const hotkey = useApp((s) => s.settings.hotkeys.sidebar)
  if (!hidden) return null
  return (
    <button
      className="icon-button"
      title={`Show the sidebar (${hotkey})`}
      aria-label="Show the sidebar"
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => useApp.getState().toggleSidebar()}
    >
      <Icon name="sidebar" />
    </button>
  )
}
