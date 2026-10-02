import { useApp } from '../store'

/** A box near the top of the window for the quick switcher and search; Esc or a click outside closes it. */
export function Overlay({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const close = (): void => useApp.getState().setOverlay(null)
  return (
    <div className="overlay-backdrop" onMouseDown={close}>
      <div
        className="overlay"
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}
