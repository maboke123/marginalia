import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'
import { useApp } from './store'

export function App(): React.JSX.Element | null {
  const ready = useApp((s) => s.ready)
  const vault = useApp((s) => s.vault)
  const error = useApp((s) => s.error)
  const showError = useApp((s) => s.showError)

  useEffect(() => {
    useApp.getState().init()
    return window.api.vault.onChanged(() => useApp.getState().refresh())
  }, [])

  if (!ready) return null

  return (
    <>
      {vault ? (
        <div className="layout">
          <Sidebar />
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
